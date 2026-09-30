#!/usr/bin/env node

// Pilot wrapper for an installed OpenCode CLI. The generic adapter still owns
// versioning and exact-session validation; this wrapper only translates the CLI.
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	ADAPTER_PROTOCOL,
	ADAPTER_VERSION,
	AdapterError,
	CAPABILITIES,
	destinationFromEndpoint,
	invokeProcess,
	normalizeResult,
	parseJson,
} from "./generic.mjs";

const PROVIDER = "planr-local";
const MAX_PACKET_BYTES = 4 * 1024 * 1024;

function settings(env) {
	const endpoint = env.PLANR_OPENCODE_BASE_URL;
	const model = env.PLANR_OPENCODE_MODEL;
	const stateDir = env.PLANR_OPENCODE_STATE_DIR;
	if (!endpoint || !model || !stateDir || !isAbsolute(stateDir)) {
		throw new AdapterError(
			"E_ADAPTER_CONFIG",
			"OpenCode pilot needs an endpoint, model, and absolute state directory.",
		);
	}
	let url;
	try {
		url = new URL(endpoint);
	} catch {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"OpenCode pilot endpoint is invalid.",
		);
	}
	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.pathname !== "/v1" ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	) {
		throw new AdapterError(
			"E_DESTINATION_UNKNOWN",
			"OpenCode pilot requires a loopback OpenAI-compatible /v1 endpoint.",
		);
	}
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(model) ||
		model.includes("..")
	) {
		throw new AdapterError(
			"E_ADAPTER_CONFIG",
			"OpenCode pilot model ID is invalid.",
		);
	}
	return {
		endpoint: url.href.replace(/\/$/u, ""),
		model,
		stateDir: resolve(stateDir),
	};
}

function configFor({ endpoint, model }, capsuleDirectory) {
	return {
		$schema: "https://opencode.ai/config.json",
		model: `${PROVIDER}/${model}`,
		...(capsuleDirectory ? {
			permission: {
				external_directory: { [`${capsuleDirectory}/**`]: "allow" },
				read: { [`${capsuleDirectory}/**`]: "allow" },
				edit: { [`${capsuleDirectory}/**`]: "deny" },
			},
		} : {}),
		provider: {
			[PROVIDER]: {
				npm: "@ai-sdk/openai-compatible",
				name: "OpenPlanr local pilot",
				options: {
					baseURL: endpoint,
					apiKey: "{env:LM_STUDIO_API_KEY}",
				},
				models: {
					[model]: { name: model, limit: { context: 32768, output: 8192 } },
				},
			},
		},
	};
}

async function capsuleDirectory(path) {
	if (typeof path !== "string" || !isAbsolute(path) || basename(path) !== "capsule.json" || basename(dirname(path)) !== "capsule") {
		throw new AdapterError("E_ADAPTER_ARGUMENTS", "OpenCode requires an exact private capsule path.");
	}
	let physical;
	let canonicalDirectory;
	let file;
	let directory;
	try {
		physical = await realpath(path);
		canonicalDirectory = await realpath(dirname(path));
		file = await lstat(path);
		directory = await lstat(dirname(path));
	} catch {
		throw new AdapterError("E_ADAPTER_ARGUMENTS", "OpenCode capsule path is unavailable.");
	}
	if (physical !== join(canonicalDirectory, "capsule.json") || !file.isFile() || !directory.isDirectory() || file.size > 32 * 1024 * 1024 || (file.mode & 0o077) !== 0 || (directory.mode & 0o077) !== 0 || (process.getuid && (file.uid !== process.getuid() || directory.uid !== process.getuid()))) {
		throw new AdapterError("E_ADAPTER_ARGUMENTS", "OpenCode capsule path is not a private regular file.");
	}
	return dirname(physical);
}

async function privateState(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const info = await lstat(path);
	if (
		!info.isDirectory() ||
		(info.mode & 0o077) !== 0 ||
		(process.getuid && info.uid !== process.getuid())
	) {
		throw new AdapterError(
			"E_ADAPTER_CONFIG",
			"OpenCode state directory must be private to this user.",
		);
	}
}

async function runtimeEnvironment(env, root, config, cwd) {
	for (const path of ["home", "config", "data", "cache"]) {
		await privateState(join(root, path));
	}
	return {
		PATH: env.PATH ?? "",
		TMPDIR: env.TMPDIR ?? tmpdir(),
		LANG: env.LANG ?? "C.UTF-8",
		HOME: join(root, "home"),
		XDG_CONFIG_HOME: join(root, "config"),
		XDG_DATA_HOME: join(root, "data"),
		XDG_CACHE_HOME: join(root, "cache"),
		OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
		PWD: cwd,
		...(env.LM_STUDIO_API_KEY
			? { LM_STUDIO_API_KEY: env.LM_STUDIO_API_KEY }
			: {}),
	};
}

async function checkModel({ endpoint, model }, env) {
	let response;
	try {
		response = await fetch(`${endpoint}/models`, {
			headers: env.LM_STUDIO_API_KEY
				? { Authorization: `Bearer ${env.LM_STUDIO_API_KEY}` }
				: {},
			signal: AbortSignal.timeout(5000),
		});
	} catch {
		throw new AdapterError(
			"E_ADAPTER_CONNECT",
			"OpenCode pilot endpoint is unreachable.",
		);
	}
	if (!response.ok)
		throw new AdapterError(
			"E_ADAPTER_CONNECT",
			"OpenCode pilot endpoint rejected its model inventory request.",
		);
	let inventory;
	try {
		inventory = await response.json();
	} catch {
		throw new AdapterError(
			"E_ADAPTER_CONNECT",
			"OpenCode pilot model inventory is malformed.",
		);
	}
	if (
		!Array.isArray(inventory.data) ||
		!inventory.data.some((item) => item?.id === model)
	) {
		throw new AdapterError(
			"E_ADAPTER_CONFIG",
			"OpenCode pilot model is absent from the local endpoint.",
		);
	}
}

function inspectResolvedConfig(text, { endpoint, model }) {
	const config = parseJson(text, "E_ADAPTER_INCOMPATIBLE");
	const provider = config.provider?.[PROVIDER];
	if (
		config.model !== `${PROVIDER}/${model}` ||
		provider?.options?.baseURL !== endpoint ||
		provider?.npm !== "@ai-sdk/openai-compatible" ||
		!provider.models?.[model]
	) {
		throw new AdapterError(
			"E_DESTINATION_CHANGED",
			"OpenCode effective model or endpoint differs from the enrolled pilot.",
		);
	}
	if (
		config.tools?.write === false ||
		config.tools?.bash === false ||
		config.tools?.edit === false
	) {
		throw new AdapterError(
			"E_ADAPTER_INCOMPATIBLE",
			"OpenCode editing tools are disabled.",
		);
	}
}

export async function probeOpenCode({
	cwd,
	env = process.env,
	executable = "opencode",
	argv = [],
}) {
	if (!isAbsolute(cwd))
		throw new AdapterError(
			"E_ADAPTER_CONFIG",
			"OpenCode worktree directory must be absolute.",
		);
	const declared = settings(env);
	const temporary = await mkdtemp(
		join(env.TMPDIR ?? tmpdir(), "planr-opencode-probe-"),
	);
	try {
		const childEnv = await runtimeEnvironment(
			env,
			temporary,
			configFor(declared),
			cwd,
		);
		const help = await invokeProcess(executable, [...argv, "run", "--help"], {
			cwd,
			env: childEnv,
			timeoutMs: 10_000,
			maxOutputBytes: 128 * 1024,
			captureStderr: true,
		});
		if (
			!["--format", "--session", "--model", "--agent"].every((flag) =>
				help.includes(flag),
			)
		) {
			throw new AdapterError(
				"E_ADAPTER_INCOMPATIBLE",
				"OpenCode lacks JSON output, tools, or exact-session resume.",
			);
		}
		const agents = await invokeProcess(executable, [...argv, "agent", "list"], {
			cwd,
			env: childEnv,
			timeoutMs: 10_000,
			maxOutputBytes: 256 * 1024,
		});
		if (!/^build \(primary\)$/mu.test(agents)) {
			throw new AdapterError(
				"E_ADAPTER_INCOMPATIBLE",
				"OpenCode build agent is unavailable.",
			);
		}
		const effective = await invokeProcess(
			executable,
			[...argv, "debug", "config"],
			{
				cwd,
				env: childEnv,
				timeoutMs: 10_000,
				maxOutputBytes: 1024 * 1024,
			},
		);
		inspectResolvedConfig(effective, declared);
		await checkModel(declared, env);
		return {
			destination: destinationFromEndpoint(declared.endpoint),
			capabilities: CAPABILITIES,
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export function parseOpenCodeEvents(output, expectedSessionId) {
	let sessionId;
	let finalText;
	for (const line of output.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const event = parseJson(line);
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			throw new AdapterError("E_ADAPTER_RESULT", "OpenCode returned an invalid event.");
		}
		if (event.type === "error")
			throw new AdapterError(
				"E_ADAPTER_RESULT",
				"OpenCode reported a failed turn.",
			);
		if (event.sessionID) {
			if (
				typeof event.sessionID !== "string" ||
				(sessionId && sessionId !== event.sessionID)
			) {
				throw new AdapterError(
					"E_ADAPTER_SESSION",
					"OpenCode emitted inconsistent session identifiers.",
				);
			}
			sessionId = event.sessionID;
		}
		if (event.type === "text" && typeof event.part?.text === "string")
			finalText = event.part.text;
	}
	if (!sessionId || !finalText)
		throw new AdapterError(
			"E_ADAPTER_RESULT",
			"OpenCode returned no complete structured answer.",
		);
	if (expectedSessionId && sessionId !== expectedSessionId) {
		throw new AdapterError(
			"E_ADAPTER_SESSION",
			"OpenCode resumed a different session.",
		);
	}
	return normalizeResult({ ...parseJson(finalText), sessionId });
}

export async function runOpenCode({
	cwd,
	prompt,
	capsulePath,
	sessionId,
	env = process.env,
	executable = "opencode",
	argv = [],
	timeoutMs,
}) {
	if (!isAbsolute(cwd) || typeof prompt !== "string" || !prompt.trim()) {
		throw new AdapterError(
			"E_ADAPTER_ARGUMENTS",
			"OpenCode run requires an absolute worktree and prompt.",
		);
	}
	if (
		sessionId !== undefined &&
		(typeof sessionId !== "string" || !sessionId.trim())
	) {
		throw new AdapterError(
			"E_ADAPTER_SESSION",
			"OpenCode exact session identifier is required.",
		);
	}
	const declared = settings(env);
	const allowedCapsuleDirectory = await capsuleDirectory(capsulePath);
	await privateState(declared.stateDir);
	const childEnv = await runtimeEnvironment(
		env,
		declared.stateDir,
		configFor(declared, allowedCapsuleDirectory),
		cwd,
	);
	const args = [
		...argv,
		"run",
		"--format",
		"json",
		"--model",
		`${PROVIDER}/${declared.model}`,
		"--agent",
		"build",
	];
	if (sessionId) args.push("--session", sessionId);
	const output = await invokeProcess(executable, args, {
		cwd,
		env: childEnv,
		input: prompt,
		timeoutMs,
		maxOutputBytes: 8 * 1024 * 1024,
	});
	return parseOpenCodeEvents(output, sessionId);
}

async function readPacket() {
	const chunks = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		size += chunk.length;
		if (size > MAX_PACKET_BYTES)
			throw new AdapterError(
				"E_ADAPTER_ARGUMENTS",
				"OpenCode request exceeds its size limit.",
			);
		chunks.push(chunk);
	}
	const packet = parseJson(Buffer.concat(chunks).toString("utf8"));
	if (
		packet.protocol !== ADAPTER_PROTOCOL ||
		packet.version !== ADAPTER_VERSION ||
		!isAbsolute(packet.cwd)
	) {
		throw new AdapterError(
			"E_ADAPTER_ARGUMENTS",
			"OpenCode received an invalid versioned request.",
		);
	}
	return packet;
}

export async function main(flag, options = {}) {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	let output;
	if (flag === "--planr-probe") {
		output = await probeOpenCode({ cwd, env });
	} else if (flag === "--planr-run" || flag === "--planr-resume") {
		const packet = await readPacket();
		if (
			(await realpath(packet.cwd)) !== (await realpath(cwd)) ||
			packet.operation !== (flag === "--planr-run" ? "run" : "resume")
		) {
			throw new AdapterError(
				"E_ADAPTER_ARGUMENTS",
				"OpenCode request does not match its worktree or operation.",
			);
		}
		output = await runOpenCode({
			cwd,
			env,
			prompt: packet.prompt,
			capsulePath: packet.capsulePath,
			...(flag === "--planr-resume" ? { sessionId: packet.sessionId } : {}),
		});
	} else {
		throw new AdapterError(
			"E_ADAPTER_ARGUMENTS",
			"Unknown OpenCode wrapper operation.",
		);
	}
	process.stdout.write(
		`${JSON.stringify({ protocol: ADAPTER_PROTOCOL, version: ADAPTER_VERSION, ...output })}\n`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main(process.argv[2]).catch((error) => {
		process.stderr.write(
			`${error instanceof AdapterError ? `${error.code}: ${error.message}` : "E_ADAPTER_FAILURE"}\n`,
		);
		process.exitCode = 1;
	});
}
