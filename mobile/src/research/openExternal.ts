import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

import { isSafeLibraryUrl } from "./library/links";

/**
 * Opens a library source in the browser. Only the two link shapes the library
 * builds (a PubMed record or a doi.org address over https) are ever opened; anything
 * else is ignored. Falls back to the system handler if the in-app browser is
 * unavailable.
 */
export async function openLibrarySource(url: string): Promise<boolean> {
  if (!isSafeLibraryUrl(url)) return false;
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    return Linking.openURL(url).then(
      () => true,
      () => false,
    );
  }
}
