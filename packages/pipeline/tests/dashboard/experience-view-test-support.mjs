import { sha256Jcs } from "../../lib/protocol/jcs.mjs";

function without(value, field) {
	return Object.fromEntries(
		Object.entries(value).filter(([key]) => key !== field),
	);
}

export function normalizeExperienceViewCycles(view) {
	for (const cycle of view.cycles ?? []) {
		cycle.lensAbsences ??= [];
		cycle.executiveBoard ??= null;
		for (const assignment of cycle.assignments ?? []) {
			assignment.absence ??= null;
		}
	}
	return view;
}

export function rehashExperienceView(view) {
	normalizeExperienceViewCycles(view);
	delete view.viewHash;
	view.viewHash = sha256Jcs(without(view, "viewHash"));
	return view;
}
