import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from "react-native";
import { revealOffset } from "./revealOffset";

/**
 * Keeps the panel being edited (the new-set form or a set's editor, including its
 * Log set / Save button) above the software keyboard. KeyboardAvoidingView
 * already shrinks the scroll area; this scrolls the panel into what is left.
 * It reacts to events only: focus, the keyboard appearing, the visible area
 * changing and the content growing (a logged set pushes the form down).
 *
 * The panel is remembered while any of its fields has focus. A keyboard-hidden
 * event is not used to forget it: after a set is saved the form is replaced, and
 * the old keyboard's hidden event can arrive after the new form was focused.
 */
export function useEntryReveal() {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const viewportHeight = useRef(0);
  const offset = useRef(0);
  const target = useRef<View | null>(null);
  const focusedFields = useRef(0);
  const keyboardShown = useRef(false);

  const reveal = useCallback(() => {
    const panel = target.current;
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!panel || !scroll || !content || !keyboardShown.current) return;
    panel.measureLayout(
      content,
      (_x, y, _width, height) => {
        const next = revealOffset({
          targetTop: y,
          targetBottom: y + height,
          offset: offset.current,
          viewportHeight: viewportHeight.current,
        });
        if (next !== null) scroll.scrollTo({ y: next, animated: true });
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => {
      keyboardShown.current = true;
      reveal();
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => {
      keyboardShown.current = false;
      focusedFields.current = 0;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [reveal]);

  /** A field of `panel` took focus. */
  const revealEntry = useCallback((panel: View | null) => {
    focusedFields.current += 1;
    target.current = panel;
    reveal();
  }, [reveal]);

  /** A field of the tracked panel lost focus; forget the panel once none has it. */
  const releaseEntry = useCallback(() => {
    focusedFields.current = Math.max(0, focusedFields.current - 1);
    if (focusedFields.current === 0) target.current = null;
  }, []);

  const scrollProps = {
    // The prop is typed as RefObject<View>, without the null a React 19 ref has.
    innerViewRef: contentRef as RefObject<View>,
    onLayout: (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
      reveal();
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: reveal,
    scrollEventThrottle: 16,
  };

  return { scrollRef, scrollProps, revealEntry, releaseEntry };
}
