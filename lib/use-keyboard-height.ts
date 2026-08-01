import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * The on-screen keyboard's current height, as plain React state.
 *
 * Exists because both of RN's built-in options failed us in the field:
 * KeyboardAvoidingView left its padding behind after dismissal in the message thread
 * (#37 "it won't go lower"), and Reanimated's useAnimatedKeyboard doesn't track inside
 * a react-native <Modal>'s window, which hid the comment composer behind the keyboard
 * (#9). Keyboard events fire reliably in both places; state-driven padding resets to
 * zero by construction.
 *
 * iOS uses the `will*` events so the layout moves with the keyboard's animation rather
 * than after it.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
