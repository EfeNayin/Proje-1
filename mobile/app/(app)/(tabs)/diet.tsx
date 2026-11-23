/**
 * Diet: the fifth tab. Structure only for now — a title bar and an empty page in the
 * app's light layout. What goes here has not been decided, so nothing is shown that
 * could be mistaken for real data. (Nutrition targets live under Profile, untouched.)
 */

import { StyleSheet, View } from "react-native";

import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";

export default function DietScreen() {
  return (
    <View style={styles.screen}>
      <TabTopBar title="Diet" />
      <View style={styles.content} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { flex: 1, paddingHorizontal: 16 },
});
