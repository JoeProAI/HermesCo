export type FirebaseAuthUser = {
  getIdToken: () => Promise<string>;
};

export async function getFirebaseAuthHeaders(
  user: FirebaseAuthUser,
  extraHeaders: Record<string, string> = {}
) {
  const token = await user.getIdToken();
  return {
    ...extraHeaders,
    Authorization: `Bearer ${token}`,
  };
}
