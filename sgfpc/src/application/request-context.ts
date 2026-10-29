export interface RequestContext {
    ownerUserId: string;
}

export const DEMO_FIXTURE_USER_ID = "11111111-1111-4111-8111-111111111111";

export function demoContext(): RequestContext {
    return { ownerUserId: DEMO_FIXTURE_USER_ID };
}
