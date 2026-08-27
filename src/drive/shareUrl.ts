/**
 * Drive APIの`webViewLink`を共有URL形式(`?usp=sharing`)に正規化する。
 * `webViewLink`は`?usp=drivesdk`付きで返るため、`usp`だけ差し替える。
 * 取得できていない・URLとして解釈できない場合は`fallback`を返す。
 */
export function toShareUrl(
  webViewLink: string | undefined,
  fallback: string,
): string {
  if (!webViewLink) return fallback;
  let url: URL;
  try {
    url = new URL(webViewLink);
  } catch {
    return fallback;
  }
  url.searchParams.set("usp", "sharing");
  return url.toString();
}
