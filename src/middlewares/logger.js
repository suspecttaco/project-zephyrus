export function logRequest(req, res, start) {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${durationMs}ms `);
}