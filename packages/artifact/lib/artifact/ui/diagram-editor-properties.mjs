import {
	appearanceFields,
	clone,
	elementIndex,
	geometryFields,
	parentIndex,
	semanticFields,
} from "../diagram/authoring/model.mjs";
import {
	labelOf,
	moveOrthogonalBend,
	propertyTransaction,
} from "./diagram-editor-actions.mjs";
import {
	button,
	element,
	field,
	icon,
	iconButton,
} from "./diagram-editor-dom.mjs";

const COLLECTION_LABELS = Object.freeze({
	nodes: "Node",
	relations: "Connection",
	annotations: "Annotation",
	groups: "Group",
	lanes: "Lane",
});

function cleanController(root) {
	return {
		get dirty() {
			return false;
		},
		apply() {
			return { ok: true, skipped: true };
		},
		revert() {
			return { ok: true, skipped: true };
		},
		focus() {
			root
				.querySelector(
					"input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
				)
				?.focus();
		},
	};
}

function inspectorHeader(document, { kicker, title, reference, description }) {
	const header = element(document, "header", {
		className: "de-inspector-header",
	});
	const identity = element(document, "div", {
		className: "de-inspector-identity",
	});
	identity.append(
		element(document, "span", { className: "de-inspector-kicker" }, kicker),
	);
	identity.append(
		element(document, "h2", { className: "de-inspector-title" }, title),
	);
	if (description)
		identity.append(
			element(
				document,
				"p",
				{ className: "de-inspector-description" },
				description,
			),
		);
	header.append(identity);
	if (reference)
		header.append(
			element(
				document,
				"code",
				{ className: "de-inspector-reference", title: reference },
				reference,
			),
		);
	return header;
}

function inspectorSection(
	document,
	title,
	{ iconName, open = false, className = "" } = {},
) {
	const details = element(document, "details", {
		className: ["de-inspector-section", className].filter(Boolean).join(" "),
		...(open ? { open: true } : {}),
	});
	const summary = element(document, "summary", {
		className: "de-inspector-section-summary",
	});
	if (iconName) summary.append(icon(document, iconName, { size: 15 }));
	summary.append(element(document, "span", {}, title));
	const body = element(document, "div", {
		className: "de-inspector-section-body",
	});
	details.append(summary, body);
	return { details, body };
}

function actionRow(document, target, items, { className = "" } = {}) {
	const row = element(document, "div", {
		className: ["de-actions", "de-inspector-action-row", className]
			.filter(Boolean)
			.join(" "),
	});
	for (const [label, action, iconName, attributes = {}] of items) {
		row.append(
			iconName
				? iconButton(document, label, action, { icon: iconName, ...attributes })
				: button(document, label, action, attributes),
		);
	}
	target.append(row);
	return row;
}

/** Context-specific controls; validation and mutation remain in the session. */
export function renderDiagramProperties({
	root,
	state,
	editable,
	act,
	submitTransaction,
	onDirtyChange,
}) {
	const document = root.ownerDocument;
	const bundle = state.bundle;
	const ids = state.view.selection;
	root.replaceChildren();
	root.classList.add("de-inspector");
	root.dataset.inspectorSelection =
		ids.length > 1 ? "multiple" : ids.length === 1 ? "single" : "none";

	if (!bundle) {
		root.append(
			inspectorHeader(document, {
				kicker: "Unavailable",
				title: "Diagram access changed",
			}),
		);
		root.append(
			element(
				document,
				"p",
				{ className: "de-inspector-empty" },
				"Reopen this diagram with a current owner session.",
			),
		);
		onDirtyChange?.(false);
		return cleanController(root);
	}
	const byId = elementIndex(bundle.document);
	const placements = new Map(
		bundle.presentation.elements.map((item) => [item.elementId, item]),
	);

	if (!ids.length) {
		root.append(
			inspectorHeader(document, {
				kicker: "Diagram",
				title: "Diagram details",
				reference: bundle.diagramId,
				description: bundle.document.title,
			}),
		);
		const overview = inspectorSection(document, "Overview", {
			iconName: "content",
			open: true,
		});
		overview.body.append(
			element(
				document,
				"p",
				{},
				editable
					? "Select an object on the canvas or in the outline to edit its properties."
					: "Select an object to inspect its properties.",
			),
			element(
				document,
				"p",
				{ className: "de-muted" },
				`Profile: ${bundle.document.grammar.id}. Layout and meaning are saved together.`,
			),
		);
		const title = field(document, "Diagram title", bundle.document.title, {
			maxlength: 240,
			disabled: !editable,
		});
		overview.body.append(title.label);
		const changeTitle = iconButton(document, "Update title", "update-title", {
			icon: "save",
			disabled: !editable,
		});
		changeTitle.onclick = () => act("update-title", title.input.value);
		overview.body.append(changeTitle);
		root.append(overview.details);
		onDirtyChange?.(false);
		return cleanController(root);
	}

	if (ids.length > 1) {
		renderMultiSelection({ document, root, bundle, ids, byId, editable, act });
		onDirtyChange?.(false);
		return cleanController(root);
	}

	const id = ids[0];
	const entry = byId.get(id);
	const place = placements.get(id);
	const sem = semanticFields(entry.collection, entry.value);
	const geom = geometryFields(place);
	const look = appearanceFields(place);
	root.append(
		inspectorHeader(document, {
			kicker: `${COLLECTION_LABELS[entry.collection] ?? "Object"} properties`,
			title: labelOf(entry.value),
			reference: id,
		}),
	);

	const form = element(document, "form", {
		className: "de-properties-form de-inspector-form",
		"aria-label": "Object properties",
	});
	const inputs = new Map();
	const trackedInputs = new Set();
	const add = (target, name, value, options = {}) => {
		const item = field(document, name, value, {
			disabled: !editable,
			...options,
		});
		inputs.set(name, item.input);
		trackedInputs.add(item.input);
		target.append(item.label);
		return item.input;
	};

	const content = inspectorSection(document, "Content", {
		iconName: "content",
		open: true,
	});
	add(content.body, "Label", labelOf(entry.value), { maxlength: 500 });
	if (entry.collection === "nodes") {
		add(content.body, "Description", sem.description, {
			multiline: true,
			maxlength: 4000,
		});
		add(content.body, "Semantic role", sem.kind, {
			choices: [
				"process",
				"start",
				"end",
				"decision",
				"data-store",
				"component",
			],
		});
	}
	form.append(content.details);

	const geometry = inspectorSection(document, "Geometry", {
		iconName: "geometry",
		open: true,
	});
	if (geom.bounds) {
		const grid = element(document, "div", { className: "de-field-grid" });
		for (const [name, key] of [
			["X", "x"],
			["Y", "y"],
			["Width", "width"],
			["Height", "height"],
		]) {
			const lock = ["x", "y"].includes(key)
				? place.locks.position
				: place.locks.size;
			add(grid, name, geom.bounds[key], {
				type: "number",
				step: "1",
				min: ["width", "height"].includes(key) ? 1 : -1000000,
				max: 1000000,
				disabled: !editable || lock,
			});
		}
		geometry.body.append(grid);
		if (place.locks.position || place.locks.size)
			geometry.body.append(
				element(
					document,
					"p",
					{ className: "de-muted" },
					"Geometry is locked. Use Unlock selection to change it.",
				),
			);
	} else
		geometry.body.append(
			element(
				document,
				"p",
				{ className: "de-muted" },
				"This object is positioned by its connected endpoints.",
			),
		);
	form.append(geometry.details);

	if (entry.collection === "relations") {
		const connection = inspectorSection(document, "Connection", {
			iconName: "route",
			open: true,
		});
		const choices = bundle.document.nodes.map((node) => [node.id, node.label]);
		add(connection.body, "From", sem.from, { choices });
		add(connection.body, "To", sem.to, { choices });
		add(connection.body, "Direction", sem.direction, {
			choices: [
				["forward", "Forward"],
				["both", "Both directions"],
				["none", "No arrow"],
			],
		});
		add(connection.body, "Relationship", sem.kind, {
			choices: ["association", "dependency", "flow", "message", "transition"],
		});
		add(connection.body, "Routing", geom.route.strategy, {
			choices: ["straight", "orthogonal"],
			disabled: !editable || place.locks.route,
		});
		const endpointGrid = element(document, "div", {
			className: "de-field-grid",
		});
		add(endpointGrid, "Start side", geom.route.from.side, {
			choices: ["top", "right", "bottom", "left"],
			disabled: !editable || place.locks.route,
		});
		add(endpointGrid, "End side", geom.route.to.side, {
			choices: ["top", "right", "bottom", "left"],
			disabled: !editable || place.locks.route,
		});
		connection.body.append(endpointGrid);
		const bends = element(document, "fieldset", {
			className: "de-inspector-bends",
		});
		bends.append(element(document, "legend", {}, "Bend points"));
		const points =
			geom.route.mode === "manual" ? geom.route.points.slice(1, -1) : [];
		points.forEach((point, index) => {
			const row = element(document, "div", {
				className: "de-field-grid de-bend-row",
			});
			for (const key of ["x", "y"])
				add(row, `Bend ${index + 1} ${key.toUpperCase()}`, point[key], {
					type: "number",
					disabled: !editable || place.locks.route,
				});
			const remove = iconButton(
				document,
				`Remove bend ${index + 1}`,
				"remove-bend",
				{ icon: "trash", disabled: !editable || place.locks.route },
			);
			remove.onclick = () => act("remove-bend", index);
			row.append(remove);
			bends.append(row);
		});
		bends.append(
			iconButton(document, "Add bend", "add-bend", {
				icon: "plus",
				disabled: !editable || place.locks.route,
			}),
		);
		connection.body.append(bends);
		actionRow(document, connection.body, [
			[
				"Reset route",
				"reset-route",
				"route",
				{ disabled: !editable || place.locks.route },
			],
		]);
		if (geom.label) {
			const labelGrid = element(document, "div", {
				className: "de-field-grid",
			});
			add(labelGrid, "Label X", geom.label.x, { type: "number" });
			add(labelGrid, "Label Y", geom.label.y, { type: "number" });
			add(labelGrid, "Label width", geom.label.width, {
				type: "number",
				min: 1,
			});
			connection.body.append(labelGrid);
		} else
			connection.body.append(
				iconButton(document, "Position label", "position-label", {
					icon: "geometry",
					disabled: !editable,
				}),
			);
		form.append(connection.details);
	}

	const appearance = inspectorSection(document, "Appearance", {
		iconName: "appearance",
	});
	add(appearance.body, "Fill", look.appearance.fill, {
		choices: [
			"surface",
			"accent",
			"success",
			"warning",
			"danger",
			"transparent",
		],
	});
	add(appearance.body, "Stroke", look.appearance.stroke, {
		choices: ["default", "accent", "muted", "danger", "none"],
	});
	add(appearance.body, "Line style", look.appearance.strokeStyle, {
		choices: ["solid", "dashed", "dotted"],
	});
	add(appearance.body, "Font size", look.appearance.fontSize, {
		type: "number",
		min: 12,
		max: 48,
	});
	form.append(appearance.details);

	if (
		entry.collection !== "relations" ||
		["groups", "lanes"].includes(entry.collection)
	) {
		const structure = inspectorSection(document, "Structure", {
			iconName: "structure",
		});
		if (entry.collection !== "relations")
			appendParentControl(structure.body, ids);
		if (["groups", "lanes"].includes(entry.collection))
			appendMembers(structure.body);
		form.append(structure.details);
	}

	const constraints = inspectorSection(document, "Constraints", {
		iconName: "constraints",
	});
	for (const [name, key] of [
		["Lock position", "position"],
		["Lock size", "size"],
		["Lock route", "route"],
	]) {
		if (key === "route" && entry.collection !== "relations") continue;
		if (key !== "route" && !geom.bounds) continue;
		add(constraints.body, name, look.locks[key], { type: "checkbox" });
	}
	actionRow(document, constraints.body, [
		["Unlock selection", "unlock", "unlock", { disabled: !editable }],
	]);
	form.append(constraints.details);

	const objectActions = inspectorSection(document, "Object actions", {
		iconName: "advanced",
	});
	actionRow(document, objectActions.body, [
		["Copy", "copy", "copy", { disabled: !editable }],
		["Duplicate", "duplicate", "duplicate", { disabled: !editable }],
	]);
	form.append(objectActions.details);

	const advanced = inspectorSection(document, "Advanced", {
		iconName: "advanced",
	});
	const metadata = element(document, "dl", { className: "de-inspector-meta" });
	metadata.append(
		element(document, "dt", {}, "Reference"),
		element(document, "dd", {}, id),
		element(document, "dt", {}, "Object type"),
		element(
			document,
			"dd",
			{},
			COLLECTION_LABELS[entry.collection] ?? entry.collection,
		),
		element(document, "dt", {}, "Grammar"),
		element(document, "dd", {}, bundle.document.grammar.id),
	);
	advanced.body.append(metadata);
	form.append(advanced.details);

	const danger = element(document, "section", {
		className: "de-inspector-danger",
		"aria-labelledby": "de-danger-title",
	});
	danger.append(
		element(document, "h3", { id: "de-danger-title" }, "Danger zone"),
	);
	danger.append(
		iconButton(document, "Delete selection…", "delete", {
			icon: "trash",
			className: "de-danger",
			disabled: !editable,
		}),
	);
	form.append(danger);

	const footer = element(document, "footer", {
		className: "de-inspector-footer",
	});
	const revertButton = button(document, "Revert", "revert-properties", {
		disabled: true,
	});
	const applyButton = element(
		document,
		"button",
		{
			type: "submit",
			className: "de-primary",
			"aria-label": "Apply properties",
			disabled: true,
		},
		"Apply changes",
	);
	footer.append(revertButton, applyButton);
	form.append(footer);
	root.append(form);

	let dirty = false;
	let initialValues = captureValues();
	const setDirty = (value) => {
		if (dirty === value) return;
		dirty = value;
		applyButton.disabled = !editable || !dirty;
		revertButton.disabled = !editable || !dirty;
		form.dataset.dirty = String(dirty);
		onDirtyChange?.(dirty);
	};
	const refreshDirty = () =>
		setDirty(
			[...trackedInputs].some(
				(input) => inputValue(input) !== initialValues.get(input),
			),
		);
	const apply = () => {
		if (!editable || !dirty) return { ok: true, skipped: true };
		const result = submitTransaction(buildPropertyTransaction());
		if (result?.ok) {
			initialValues = captureValues();
			setDirty(false);
		}
		return result;
	};
	const revert = () => {
		for (const [input, value] of initialValues) {
			if (input.type === "checkbox") input.checked = value;
			else input.value = value;
		}
		setDirty(false);
		return { ok: true };
	};
	const focus = () =>
		[...trackedInputs].find((input) => !input.disabled)?.focus();
	form.addEventListener("input", (event) => {
		if (trackedInputs.has(event.target)) refreshDirty();
	});
	form.addEventListener("change", (event) => {
		if (trackedInputs.has(event.target)) refreshDirty();
	});
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		apply();
	});
	revertButton.onclick = revert;
	form.dataset.dirty = "false";
	onDirtyChange?.(false);

	return {
		get dirty() {
			return dirty;
		},
		apply,
		revert,
		focus,
	};

	function inputValue(input) {
		return input.type === "checkbox" ? input.checked : input.value;
	}
	function captureValues() {
		return new Map(
			[...trackedInputs].map((input) => [input, inputValue(input)]),
		);
	}

	function buildPropertyTransaction() {
		const nextSem = clone(sem),
			nextGeom = clone(geom),
			nextLook = clone(look);
		const value = (name) => inputs.get(name)?.value;
		const number = (name) => Number(value(name));
		if (entry.collection === "annotations") nextSem.text = value("Label");
		else
			nextSem.label =
				value("Label") || (entry.collection === "relations" ? null : "");
		if (entry.collection === "nodes") {
			nextSem.description = value("Description") || null;
			nextSem.kind = value("Semantic role");
			nextLook.appearance.shape = {
				process: "rectangle",
				start: "ellipse",
				end: "ellipse",
				decision: "diamond",
				"data-store": "cylinder",
				component: "rounded-rectangle",
			}[nextSem.kind];
		}
		if (nextGeom.bounds)
			for (const [name, key] of [
				["X", "x"],
				["Y", "y"],
				["Width", "width"],
				["Height", "height"],
			])
				nextGeom.bounds[key] = number(name);
		if (entry.collection === "relations") {
			nextSem.from = value("From");
			nextSem.to = value("To");
			nextSem.direction = value("Direction");
			nextSem.kind = value("Relationship");
			nextGeom.route.strategy = value("Routing");
			nextGeom.route.from.side = value("Start side");
			nextGeom.route.to.side = value("End side");
			if (nextGeom.route.mode === "manual")
				nextGeom.route.points.slice(1, -1).forEach((_, index) => {
					const original = geom.route.points[index + 1],
						x = number(`Bend ${index + 1} X`),
						y = number(`Bend ${index + 1} Y`);
					if (x === original.x && y === original.y) return;
					if (nextGeom.route.strategy === "orthogonal")
						nextGeom.route.points = moveOrthogonalBend(
							nextGeom.route.points,
							index + 1,
							x - nextGeom.route.points[index + 1].x,
							y - nextGeom.route.points[index + 1].y,
						);
					else nextGeom.route.points[index + 1] = { x, y };
				});
			if (nextGeom.label)
				nextGeom.label = {
					x: number("Label X"),
					y: number("Label Y"),
					width: number("Label width"),
				};
		}
		nextLook.appearance.fill = value("Fill");
		nextLook.appearance.stroke = value("Stroke");
		nextLook.appearance.strokeStyle = value("Line style");
		nextLook.appearance.fontSize = number("Font size");
		for (const [name, key] of [
			["Lock position", "position"],
			["Lock size", "size"],
			["Lock route", "route"],
		])
			if (inputs.has(name)) nextLook.locks[key] = inputs.get(name).checked;
		return propertyTransaction(bundle, id, {
			semantic: nextSem,
			geometry: nextGeom,
			appearance: nextLook,
		});
	}

	function appendParentControl(target, selectedIds) {
		const parents = parentIndex(bundle.document),
			current = parents.get(selectedIds[0]) ?? "";
		const choices = [
			["", "Diagram root"],
			...[...bundle.document.groups, ...bundle.document.lanes]
				.filter((item) => !selectedIds.includes(item.id))
				.map((item) => [item.id, item.label]),
		];
		const operation = element(document, "div", {
			className: "de-inspector-operation",
		});
		const parent = field(document, "Parent", current, {
			choices,
			disabled: !editable,
		});
		operation.append(parent.label);
		const move = iconButton(document, "Move to parent", "reparent", {
			icon: "parent",
			disabled: !editable,
		});
		move.onclick = () => act("reparent", parent.input.value || null);
		operation.append(move);
		target.append(operation);
	}

	function appendMembers(target) {
		target.append(
			element(
				document,
				"h3",
				{ className: "de-inspector-subheading" },
				"Members",
			),
		);
		const members = element(document, "ul", {
			className: "de-inspector-member-list",
			"aria-label": "Members",
		});
		for (const member of entry.value.members) {
			const item = element(document, "li", {
				className: "de-inspector-member",
			});
			item.append(
				button(document, labelOf(byId.get(member).value), "select-member", {
					"data-member": member,
				}),
			);
			members.append(item);
		}
		if (entry.value.members.length) target.append(members);
		else
			target.append(
				element(
					document,
					"p",
					{ className: "de-muted" },
					"No members. Select objects and choose this parent to add them.",
				),
			);
		actionRow(document, target, [
			[
				"Arrange horizontally…",
				"lane-horizontal",
				"arrange",
				{ disabled: !editable },
			],
			[
				"Arrange vertically…",
				"lane-vertical",
				"arrange",
				{ disabled: !editable },
			],
			["Ungroup", "ungroup", "ungroup", { disabled: !editable }],
		]);
		if (entry.collection === "lanes")
			actionRow(document, target, [
				["Move lane up", "lane-up", "arrow-up", { disabled: !editable }],
				["Move lane down", "lane-down", "arrow-down", { disabled: !editable }],
			]);
		target.append(
			button(
				document,
				state.view.collapsedGroups.includes(id)
					? "Expand contents"
					: "Collapse contents",
				"collapse",
				{ disabled: !editable },
			),
		);
	}
}

function renderMultiSelection({
	document,
	root,
	bundle,
	ids,
	byId,
	editable,
	act,
}) {
	const selectedLabels = ids
		.slice(0, 8)
		.map((id) => labelOf(byId.get(id).value));
	root.append(
		inspectorHeader(document, {
			kicker: "Multiple selection",
			title: `${ids.length} objects selected`,
			reference: `${ids.length} references`,
			description: selectedLabels.join(", "),
		}),
	);
	const arrange = inspectorSection(document, "Arrange", {
		iconName: "arrange",
		open: true,
	});
	actionRow(document, arrange.body, [
		["Align left", "align-left", "arrange", { disabled: !editable }],
		["Align top", "align-top", "arrange", { disabled: !editable }],
		["Align centers", "align-center", "arrange", { disabled: !editable }],
		[
			"Distribute horizontally",
			"distribute-horizontal",
			"arrange",
			{ disabled: !editable },
		],
		[
			"Distribute vertically",
			"distribute-vertical",
			"arrange",
			{ disabled: !editable },
		],
	]);
	root.append(arrange.details);
	const structure = inspectorSection(document, "Structure", {
		iconName: "structure",
		open: true,
	});
	actionRow(document, structure.body, [
		["Group selection", "group", "group", { disabled: !editable }],
		["Ungroup selection", "ungroup", "ungroup", { disabled: !editable }],
		["Connect selection", "connect", "connect", { disabled: !editable }],
	]);
	appendMultiParentControl(structure.body);
	root.append(structure.details);
	const clipboard = inspectorSection(document, "Clipboard", {
		iconName: "copy",
	});
	actionRow(document, clipboard.body, [
		["Copy", "copy", "copy", { disabled: !editable }],
		["Paste", "paste", "copy", { disabled: !editable }],
		["Duplicate", "duplicate", "duplicate", { disabled: !editable }],
	]);
	root.append(clipboard.details);
	const constraints = inspectorSection(document, "Constraints", {
		iconName: "constraints",
	});
	actionRow(document, constraints.body, [
		["Lock selection", "lock", "lock", { disabled: !editable }],
		["Unlock selection", "unlock", "unlock", { disabled: !editable }],
	]);
	root.append(constraints.details);
	const advanced = inspectorSection(document, "Advanced", {
		iconName: "advanced",
	});
	advanced.body.append(
		element(
			document,
			"p",
			{ className: "de-reference" },
			`References: ${ids.join(", ")}`,
		),
	);
	root.append(advanced.details);
	const danger = element(document, "section", {
		className: "de-inspector-danger",
		"aria-labelledby": "de-multi-danger-title",
	});
	danger.append(
		element(document, "h3", { id: "de-multi-danger-title" }, "Danger zone"),
	);
	danger.append(
		iconButton(document, "Delete selection…", "delete", {
			icon: "trash",
			className: "de-danger",
			disabled: !editable,
		}),
	);
	root.append(danger);

	function appendMultiParentControl(target) {
		const parents = parentIndex(bundle.document),
			current = parents.get(ids[0]) ?? "";
		const choices = [
			["", "Diagram root"],
			...[...bundle.document.groups, ...bundle.document.lanes]
				.filter((item) => !ids.includes(item.id))
				.map((item) => [item.id, item.label]),
		];
		const operation = element(document, "div", {
			className: "de-inspector-operation",
		});
		const parent = field(document, "Parent", current, {
			choices,
			disabled: !editable,
		});
		operation.append(parent.label);
		const move = iconButton(document, "Move to parent", "reparent", {
			icon: "parent",
			disabled: !editable,
		});
		move.onclick = () => act("reparent", parent.input.value || null);
		operation.append(move);
		target.append(operation);
	}
}
