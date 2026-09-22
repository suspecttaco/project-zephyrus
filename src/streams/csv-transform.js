import { Transform } from "node:stream";

export const CSV_HEADER = "id,accountId,type,amount,category,description,date\n";

function escapeCsvField(value) {
    const str = String(value);

    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
}

export function createCsvTransform() {
    return new Transform({
        objectMode: true,
        transform(movement, _encoding, callback) {
            const row = [
                movement.id,
                movement.accountId,
                movement.type,
                movement.amount,
                movement.category,
                movement.description,
                movement.date,
            ]
                .map(escapeCsvField)
                .join(",");

            callback(null, `${row}\n`);
        }
    });
}