/**
 * Ed25519 public key used to verify license tokens issued by the central license server.
 * Only the public half ships with the desktop app; the private signing key never leaves the server.
 *
 * Regenerate for production with:  npm --prefix license-server run keys:generate
 * (that script rewrites this file).
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJ1dIEptKG3Wi7I/Mcxj56xSxp6uS9KqhN01Ri8kV2Ag=
-----END PUBLIC KEY-----
`;
