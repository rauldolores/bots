import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { AdminEmailsRepo } from "../../src/db/adminEmails";

let repo: AdminEmailsRepo;

beforeEach(async () => {
  const d1 = await createTestDb();
  repo = new AdminEmailsRepo(d1);
});

describe("AdminEmailsRepo", () => {
  it("add + isAuthorized works case-insensitively", async () => {
    await repo.add("Hugo@Example.com");
    expect(await repo.isAuthorized("hugo@example.com")).toBe(true);
    expect(await repo.isAuthorized("HUGO@EXAMPLE.COM")).toBe(true);
    expect(await repo.isAuthorized("other@x.com")).toBe(false);
  });
  it("remove takes the email out", async () => {
    await repo.add("h@x.com");
    await repo.remove("h@x.com");
    expect(await repo.isAuthorized("h@x.com")).toBe(false);
  });
});
