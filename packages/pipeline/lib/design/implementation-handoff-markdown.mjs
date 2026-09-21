const line = (value) =>
	String(value)
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.trim()
		.replaceAll("\n", " ")
		.replace(/([\\`*_[\]<>#|])/gu, "\\$1");

const anchorLabel = (anchor) => {
	if (!anchor) return null;
	if (anchor.section) return `section ${anchor.section}`;
	if (anchor.reviewId) return `review ${anchor.reviewId}, comment ${anchor.pinId}`;
	if (anchor.elementId)
		return `screen ${anchor.screenId}, element ${anchor.elementId}`;
	return `screen ${anchor.screenId}`;
};

/**
 * Render the human projection from contract data only. Lifecycle state, approval,
 * and integrity values are deliberately absent: they do not describe the work.
 */
export function renderImplementationHandoffMarkdown(value) {
	const lines = [
		`# ${line(value.title)}`,
		"",
		`Design: ${line(value.basis.designId)}`,
		`Selected direction: ${line(value.basis.selectedVariant)}`,
		`Authority: Prepare Plan`,
		"",
		"## Source references",
		"",
	];

	for (const source of value.sources) {
		const anchor = anchorLabel(source.anchor);
		lines.push(
			`- **${line(source.id)}** — ${line(source.kind)} · \`${line(source.path)}\`${anchor ? ` · ${line(anchor)}` : ""}`,
		);
	}
	if (!value.sources.length) lines.push("None recorded.");

	lines.push("", "## Implementation requirements", "");
	for (const requirement of value.requirements) {
		lines.push(
			`### ${line(requirement.id)} · ${line(requirement.kind)}`,
			"",
			line(requirement.statement),
			"",
			`Sources: ${requirement.sourceRefs.map((reference) => `\`${line(reference)}\``).join(", ")}`,
			"",
			"Verification:",
			...requirement.verification.map((expectation) => `- ${line(expectation)}`),
			"",
		);
	}

	lines.push(
		"This package prepares approved design context for Plan. Plan and Ship remain separate user invocations.",
		"",
	);
	return lines.join("\n");
}
