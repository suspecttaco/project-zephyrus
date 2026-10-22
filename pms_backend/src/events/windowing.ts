export interface Window {
    start: number;
    end: number;
    count: number;
}

export function tumblingWindows(timestamps: number[], sizeMs: number): Window[] {
    const counts = new Map<number, number>();
    for (const t of timestamps) {
        const start = Math.floor(t / sizeMs) * sizeMs;
        counts.set(start, (counts.get(start) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([start, count]) => ({ start, end: start + sizeMs, count }));
}

export function slidingWindows(timestamps: number[], sizeMs: number, slideMs: number): Window[] {
    if (timestamps.length === 0) return [];
    const sorted = [...timestamps].sort((a, b) => a - b);
    const first = Math.floor((sorted[0] - sizeMs + slideMs) / slideMs) * slideMs;
    const windows: Window[] = [];
    for (let start = first; start <= sorted[sorted.length - 1]; start += slideMs) {
        const count = sorted.filter((t) => t >= start && t < start + sizeMs).length;
        if (count > 0) windows.push({ start, end: start + sizeMs, count });
    }
    return windows;
}

export function sessionWindows(timestamps: number[], gapMs: number): Window[] {
    if (timestamps.length === 0) return [];
    const sorted = [...timestamps].sort((a, b) => a - b);
    const sessions: Window[] = [];
    let current: Window = { start: sorted[0], end: sorted[0] + 1, count: 1 };
    for (const t of sorted.slice(1)) {
        if (t - (current.end - 1) > gapMs) {
            sessions.push(current);
            current = { start: t, end: t + 1, count: 1 };
        } else {
            current.end = t + 1;
            current.count++;
        }
    }
    sessions.push(current);
    return sessions;
}
