/**
 * The old Programs tab, kept only as a redirect.
 *
 * Programs are now part of Start Workout ("Create program" and "My programs"),
 * so the tab is gone from the bar. This route remains because /programs was a
 * real address: a saved link, a notification or an old build's habit must land
 * on the integrated section rather than on a "not found" page. Nothing in the app
 * itself navigates here any more (Save as template opens /program/new).
 */

import { Redirect } from "expo-router";

export default function ProgramsRedirect() {
  return <Redirect href="/" />;
}
