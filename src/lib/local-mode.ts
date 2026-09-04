export function localTestEnabled() {
  return process.env.NODE_ENV === "development" && process.env.LOCAL_TEST_MODE === "true";
}
