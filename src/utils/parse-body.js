export function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";

        req.on("data", (chunk) => {
            raw += chunk;
        });

        req.on("end", () => {
            if (!raw) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error("invalid_json"));
            }
        });

        req.on("error", reject);
    });
}