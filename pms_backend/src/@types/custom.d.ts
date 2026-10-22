declare namespace Express {
    interface Request {
        user?: {
            user_id?: string;
            username?: string;
            email?: string;
            rights?: string[];
        };
    }
}