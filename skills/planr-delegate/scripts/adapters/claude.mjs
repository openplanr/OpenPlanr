import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
	AdapterError,
	CAPABILITIES,
	destinationFromEndpoint,
	extractTerminalJsonObject,
	invokeProcess,
	normalizeResult,
	parseJson,
} from "./generic.mjs";

function configDirectory(profile, env) {
	return (
		profile.configDir ??
		env.CLAUDE_CONFIG_DIR ??
		join(env.HOME ?? "", ".claude")
	);
}

// Claude confines file tools to cwd unless an additional directory is enrolled.
// Never allow the private run root, profile directory, or an arbitrary path here.
async function capsuleDirectory(path) {
	if (
		typeof path !== "string" ||
		!isAbsolute(path) ||
		basename(path) !== "capsule.json" ||
		basename(dirname(path)) !== "capsule"
	) {
		throw new AdapterError(
			"E_ADAPTER_ARGUMENTS",
			"Claude requires an exact private capsule path.",
		);
	}
	try {
		const [physical, directory, file, folder] = await Promise.all([
			realpath(path),
			realpath(dirname(path)),
			lstat(path),
			lstat(dirname(path)),
		]);
		if (
			physical !== join(directory, "capsule.json") ||
			!file.isFile() ||
			!folder.isDirectory() ||
			file.size > 32 * 1024 * 1024 ||
			(file.mode & 0o077) !== 0 ||
			(folder.mode & 0o077) !== 0 ||
			(process.getuid &&
				(file.uid !== process.getuid() || folder.uid !== process.getuid()))
		) {
			throw new Error("invalid capsule");
		}
		return directory;
	} catch {
		throw new AdapterError(
			"E_ADAPTER_ARGUMENTS",
			"Claude capsule path is not a private regular file.",
		);
	}
}

async function readSettings(path) {
	try {
		if ((await stat(path)).size > 64 * 1024) {
			throw new AdapterError(
				"E_DESTINATION_UNKNOWN",
				"Claude settings exceed the inspection limit.",
			);
		}
		const settings = parseJson(
			await readFile(path, "utf8"),
			"E_DESTINATION_UNKNOWN",
		);
		if (
			settings.env &&
			(typeof settings.env !== "object" || Array.isArray(settings.env))
		) {
			throw new AdapterError(
				"E_DESTINATION_UNKNOWN",
				"Claude settings environment is invalid.",
			);
		}
		return settings;
	} catch (error) {
		if (error.code === "ENOENT") return null;
		if (error instanceof AdapterError) throw error;
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude settings could not be inspected.",
		);
	}
}

function ancestorDirectories(cwd) {
	if (!cwd || !isAbsolute(cwd)) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude worktree directory is required to inspect project settings.",
		);
	}
	const directories = [];
	for (let cursor = resolve(cwd); ; cursor = dirname(cursor)) {
		directories.push(cursor);
		if (cursor === dirname(cursor)) break;
	}
	return directories;
}

export async function resolveClaudeDestination(profile, env, cwd) {
	const directory = configDirectory(profile, env);
	if (!directory || !isAbsolute(directory)) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude configuration directory is unknown.",
		);
	}
	const paths = [
		"/Library/Application Support/ClaudeCode/managed-settings.json",
		"/etc/claude-code/managed-settings.json",
		join(directory, "managed-settings.json"),
		join(directory, "settings.json"),
		join(directory, "settings.local.json"),
		...ancestorDirectories(cwd).flatMap((path) => [
			join(path, ".claude", "settings.json"),
			join(path, ".claude", "settings.local.json"),
		]),
	];
	const values = [];
	const providerFlags = [];
	for (const path of new Set(paths)) {
		const settings = await readSettings(path);
		if (!settings) continue;
		for (const source of [settings, settings.env ?? {}]) {
			if (source.ANTHROPIC_BASE_URL) values.push(source.ANTHROPIC_BASE_URL);
			for (const key of [
				"CLAUDE_CODE_USE_BEDROCK",
				"CLAUDE_CODE_USE_VERTEX",
				"CLAUDE_CODE_USE_FOUNDRY",
			]) {
				if (["1", "true"].includes(String(source[key]).toLowerCase()))
					providerFlags.push(key);
			}
		}
	}
	if (env.ANTHROPIC_BASE_URL) values.push(env.ANTHROPIC_BASE_URL);
	for (const key of [
		"CLAUDE_CODE_USE_BEDROCK",
		"CLAUDE_CODE_USE_VERTEX",
		"CLAUDE_CODE_USE_FOUNDRY",
	]) {
		if (["1", "true"].includes(String(env[key]).toLowerCase()))
			providerFlags.push(key);
	}
	if (providerFlags.length) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude cloud-provider endpoint needs explicit adapter support before delegation.",
		);
	}
	if (!values.length) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude effective endpoint is unknown; configure ANTHROPIC_BASE_URL before enrollment.",
		);
	}
	const destinations = values.map(destinationFromEndpoint);
	if (
		destinations.some(
			(candidate) =>
				candidate.class !== destinations[0].class ||
				candidate.origin !== destinations[0].origin,
		)
	) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"Claude settings disagree on the data destination.",
		);
	}
	return destinations[0];
}

function parseClaudeOutput(envelope, expectedSessionId, exitCode = 0) {
	if (exitCode !== 0 && !envelope) {
		throw new AdapterError(
			"E_ADAPTER_EXIT",
			"Claude executable exited without structured output.",
		);
	}
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		throw new AdapterError("E_ADAPTER_RESULT", "Claude returned an invalid result envelope.");
	}
	const observedSession = typeof envelope.session_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(envelope.session_id) ? envelope.session_id : null;
	try {
		if (envelope.is_error === true) {
			throw new AdapterError(
				"E_ADAPTER_BACKEND_UNAVAILABLE",
				"Claude backend could not complete the run.",
			);
		}
		if (exitCode !== 0 || envelope.type !== "result" || !observedSession) {
			throw new AdapterError(
				"E_ADAPTER_RESULT",
				"Claude did not return a complete structured result.",
			);
		}
		if (expectedSessionId && observedSession !== expectedSessionId) {
			throw new AdapterError(
				"E_ADAPTER_SESSION",
				"Claude resumed a different session.",
			);
		}
		const result = extractTerminalJsonObject(envelope.result);
		return normalizeResult({ ...result, sessionId: observedSession });
	} catch (error) {
		if (observedSession && error instanceof AdapterError) error.sessionId = observedSession;
		throw error;
	}
}

function claudeStreamObserver(expectedSessionId, onSessionId, onActivity) {
	let terminal = null;
	let observedSession = null;
	let approvalDenials = 0;
	return {
		async onLine(line) {
			const event = parseJson(line);
			if (!event || typeof event !== "object" || Array.isArray(event)) {
				throw new AdapterError("E_ADAPTER_RESULT", "Claude emitted an invalid event.");
			}
			if (event.session_id !== undefined) {
				const id = event.session_id;
				if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ||
					(observedSession && observedSession !== id) || (expectedSessionId && expectedSessionId !== id)) {
					throw new AdapterError("E_ADAPTER_SESSION", "Claude emitted a different or invalid session identifier.");
				}
				if (!observedSession) {
					observedSession = id;
					await onSessionId?.(id);
				}
			}
			if (event.type === "result") {
				if (terminal) throw new AdapterError("E_ADAPTER_RESULT", "Claude emitted multiple terminal results.");
				terminal = event;
			}
			const denied = event.type === "user" && event.message?.content?.some?.(
				(block) => block?.type === "tool_result" && typeof block.content === "string" &&
					/command requires approval|requires approval|permission denied/iu.test(block.content),
			);
			if (denied) {
				approvalDenials += 1;
				if (approvalDenials >= 3) {
					throw new AdapterError("E_ADAPTER_PERMISSION", "Claude repeatedly attempted tools requiring approval in headless mode.");
				}
				return;
			}
			await onActivity?.();
		},
		terminal() { return terminal; },
	};
}

export const claudeAdapter = Object.freeze({
	kind: "claude",
	async probe({ profile, cwd, env, signal, timeoutMs }) {
		const destination = await resolveClaudeDestination(profile, env, cwd);
		const output = await invokeProcess(
			profile.executable,
			[...profile.argv, "--help"],
			{
				env,
				signal,
				timeoutMs: Math.min(timeoutMs ?? 10_000, 10_000),
				maxOutputBytes: 128 * 1024,
			},
		);
		if (
			!["--print", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--resume", "--session-id", "--allowedTools", "--disallowedTools"].every(
				(flag) => output.includes(flag),
			)
		) {
			throw new AdapterError(
				"E_ADAPTER_INCOMPATIBLE",
				"Claude executable lacks tools, structured print, or exact resume.",
			);
		}
		return { capabilities: CAPABILITIES, destination };
	},
	async run({ profile, cwd, prompt, capsulePath, sessionId, onSessionId, onActivity, env, signal, timeoutMs }) {
		const allowedCapsuleDirectory = await capsuleDirectory(capsulePath);
		const observer = claudeStreamObserver(sessionId, onSessionId, onActivity);
		const { exitCode } = await invokeProcess(
			profile.executable,
			[
				...profile.argv,
				"--print",
				"--output-format",
				"stream-json",
				"--verbose",
				"--include-partial-messages",
				"--permission-mode",
				"acceptEdits",
				"--disallowedTools",
				"Bash",
				...(sessionId ? ["--session-id", sessionId] : []),
				"--add-dir",
				allowedCapsuleDirectory,
			],
			{ cwd, env, input: `Shell commands are unavailable in this headless Claude handoff. Implement with file tools; the orchestrator runs checks and sends any findings back for correction. Do not attempt Bash.\n\n${prompt}`, signal, timeoutMs, withExitCode: true,
				onStdoutLine: observer.onLine, retainStdout: false },
		);
		return parseClaudeOutput(observer.terminal(), sessionId, exitCode);
	},
	async resume({ profile, cwd, prompt, capsulePath, sessionId, onSessionId, onActivity, env, signal, timeoutMs }) {
		if (typeof sessionId !== "string" || !sessionId.trim()) {
			throw new AdapterError(
				"E_ADAPTER_SESSION",
				"Exact Claude session identifier is required.",
			);
		}
		const allowedCapsuleDirectory = await capsuleDirectory(capsulePath);
		const observer = claudeStreamObserver(sessionId, onSessionId, onActivity);
		const { exitCode } = await invokeProcess(
			profile.executable,
			[
				...profile.argv,
				"--print",
				"--output-format",
				"stream-json",
				"--verbose",
				"--include-partial-messages",
				"--permission-mode",
				"acceptEdits",
				"--disallowedTools",
				"Bash",
				"--add-dir",
				allowedCapsuleDirectory,
				"--resume",
				sessionId,
			],
			{ cwd, env, input: `Shell commands remain unavailable. Correct the source with file tools; the orchestrator runs checks. Do not attempt Bash.\n\n${prompt}`, signal, timeoutMs, withExitCode: true,
				onStdoutLine: observer.onLine, retainStdout: false },
		);
		return parseClaudeOutput(observer.terminal(), sessionId, exitCode);
	},
});
