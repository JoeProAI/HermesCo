import { getFirebaseAuthHeaders } from "@/lib/firebase-auth-headers";

describe("getFirebaseAuthHeaders", () => {
  test("adds a Firebase bearer token to request headers", async () => {
    const headers = await getFirebaseAuthHeaders(
      { getIdToken: jest.fn().mockResolvedValue("abc123") },
      { "Content-Type": "application/json" }
    );

    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer abc123",
    });
  });
});
