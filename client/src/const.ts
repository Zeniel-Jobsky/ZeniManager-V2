export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const PARTICIPATION_TYPE_OPTIONS = [
  { value: "취업성공패키지", label: "취업성공패키지" },
  { value: "일반취업", label: "일반취업" },
  { value: "직업훈련", label: "직업훈련" },
  { value: "청년 특례", label: "청년 특례" },
  { value: "특정계층", label: "특정계층" },
  { value: "중장년층", label: "중장년층" },
] as const;

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
