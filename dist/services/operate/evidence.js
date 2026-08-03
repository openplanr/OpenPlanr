export function evidenceFingerprintItems(items) {
    return items
        .map(({ id, digest, sensitivity }) => ({ id, digest, sensitivity }))
        .sort((left, right) => left.id.localeCompare(right.id) ||
        left.digest.localeCompare(right.digest) ||
        left.sensitivity.localeCompare(right.sensitivity));
}
export function evidenceProjectionSources(evidence) {
    return evidence.sources.map((source) => ({
        id: source.id,
        freshness: evidence.items.some((item) => item.source === source.id && item.freshness === 'stale')
            ? 'stale'
            : evidence.items.some((item) => item.source === source.id)
                ? 'fresh'
                : 'unknown',
        status: source.status,
        itemCount: source.itemCount,
    }));
}
//# sourceMappingURL=evidence.js.map