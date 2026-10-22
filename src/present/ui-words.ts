/**
 * The operator window's words in Punjabi, looked up by their English text.
 * {0}, {1}… stand for values filled in by t(). A unit test checks that every
 * word marked in static/index.html and every t('…') in the renderer is here.
 */
import type { UiLanguage } from './format.js';

export const PA: Record<string, string> = {
  // Top bar and status
  'Kirtan Saathi': 'ਕੀਰਤਨ ਸਾਥੀ',
  'Kirtan Saathi {0}': 'ਕੀਰਤਨ ਸਾਥੀ {0}',
  'What is being recited': 'ਕੀ ਪੜ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ',
  'Which bani': 'ਕਿਹੜੀ ਬਾਣੀ',
  'Microphone or mixer input': 'ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਜਾਂ ਮਿਕਸਰ ਦੀ ਲਾਈਨ',
  Input: 'ਇਨਪੁਟ',
  'Input {0}': 'ਇਨਪੁਟ {0}',
  'Default microphone': 'ਮੂਲ ਮਾਈਕ੍ਰੋਫ਼ੋਨ',
  'Input level': 'ਆਵਾਜ਼ ਦਾ ਪੱਧਰ',
  'Start listening': 'ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ',
  'Stop listening': 'ਸੁਣਨਾ ਬੰਦ ਕਰੋ',
  'Starting…': 'ਸ਼ੁਰੂ ਹੋ ਰਿਹਾ ਹੈ…',
  'Ready to listen': 'ਸੁਣਨ ਲਈ ਤਿਆਰ',
  'Listening for the shabad…': 'ਸ਼ਬਦ ਲੱਭ ਰਿਹਾ ਹੈ…',
  'Not listening': 'ਸੁਣ ਨਹੀਂ ਰਿਹਾ',
  'Following ({0}% sure)': 'ਨਾਲ ਚੱਲ ਰਿਹਾ ਹੈ ({0}% ਯਕੀਨ)',
  'Something needs attention': 'ਕੁਝ ਧਿਆਨ ਮੰਗਦਾ ਹੈ',
  'Play a recording and follow it': 'ਰਿਕਾਰਡਿੰਗ ਚਲਾਓ ਅਤੇ ਉਸ ਦੇ ਨਾਲ ਚੱਲੋ',
  'Play a recording': 'ਰਿਕਾਰਡਿੰਗ ਚਲਾਓ',
  'Forget the current shabad and look again': 'ਮੌਜੂਦਾ ਸ਼ਬਦ ਛੱਡ ਕੇ ਮੁੜ ਲੱਭੋ',
  'Search again': 'ਮੁੜ ਲੱਭੋ',

  // Preview and steering
  'What the sangat sees': 'ਸੰਗਤ ਨੂੰ ਕੀ ਦਿਸਦਾ ਹੈ',
  'Screen is blank': 'ਸਕਰੀਨ ਖ਼ਾਲੀ ਹੈ',
  'On screen now': 'ਹੁਣ ਸਕਰੀਨ ਉੱਤੇ',
  'Previous line (Left arrow)': 'ਪਿਛਲੀ ਤੁਕ (ਖੱਬਾ ਤੀਰ)',
  Previous: 'ਪਿਛਲੀ',
  'Blank every screen (B)': 'ਸਾਰੀਆਂ ਸਕਰੀਨਾਂ ਖ਼ਾਲੀ ਕਰੋ (B)',
  Blank: 'ਖ਼ਾਲੀ ਕਰੋ',
  'Show again': 'ਮੁੜ ਦਿਖਾਓ',
  'Next line (Right arrow)': 'ਅਗਲੀ ਤੁਕ (ਸੱਜਾ ਤੀਰ)',
  Next: 'ਅਗਲੀ',

  // Side panel
  Screen: 'ਸਕਰੀਨ',
  Share: 'ਸਾਂਝਾ ਕਰੋ',
  Find: 'ਲੱਭੋ',
  App: 'ਐਪ',
  Projector: 'ਪ੍ਰੋਜੈਕਟਰ',
  'Screen for the sangat': 'ਸੰਗਤ ਲਈ ਸਕਰੀਨ',
  Show: 'ਦਿਖਾਓ',
  Hide: 'ਲੁਕਾਓ',
  'Close the projector window': 'ਪ੍ਰੋਜੈਕਟਰ ਦੀ ਵਿੰਡੋ ਬੰਦ ਕਰੋ',
  'Open the projector window on the chosen screen': 'ਚੁਣੀ ਹੋਈ ਸਕਰੀਨ ਉੱਤੇ ਪ੍ਰੋਜੈਕਟਰ ਦੀ ਵਿੰਡੋ ਖੋਲ੍ਹੋ',
  'Second screen (automatic)': 'ਦੂਜੀ ਸਕਰੀਨ (ਆਪਣੇ-ਆਪ)',
  ' (this screen)': ' (ਇਹ ਸਕਰੀਨ)',
  'Showing on {0}. Press Esc on the projector to close it.': '{0} ਉੱਤੇ ਦਿਖਾ ਰਿਹਾ ਹੈ। ਬੰਦ ਕਰਨ ਲਈ ਪ੍ਰੋਜੈਕਟਰ ਉੱਤੇ Esc ਦਬਾਓ।',
  'Showing on {0}.': '{0} ਉੱਤੇ ਦਿਖਾ ਰਿਹਾ ਹੈ।',
  'Waiting for the chosen screen to be connected.': 'ਚੁਣੀ ਹੋਈ ਸਕਰੀਨ ਦੇ ਜੁੜਨ ਦੀ ਉਡੀਕ ਹੈ।',
  'Off. Press Show to put Gurbani on the projector.': 'ਬੰਦ ਹੈ। ਪ੍ਰੋਜੈਕਟਰ ਉੱਤੇ ਗੁਰਬਾਣੀ ਲਈ ਦਿਖਾਓ ਦਬਾਓ।',
  'Only one screen is connected. Connect the projector, or show it here (Esc closes it).':
    'ਸਿਰਫ਼ ਇੱਕ ਸਕਰੀਨ ਜੁੜੀ ਹੈ। ਪ੍ਰੋਜੈਕਟਰ ਜੋੜੋ, ਜਾਂ ਇੱਥੇ ਹੀ ਦਿਖਾਓ (Esc ਨਾਲ ਬੰਦ ਹੁੰਦਾ ਹੈ)।',
  Look: 'ਦਿੱਖ',
  'Text size': 'ਅੱਖਰਾਂ ਦਾ ਆਕਾਰ',
  Colours: 'ਰੰਗ',
  Khanda: 'ਖੰਡਾ',
  Dark: 'ਗੂੜ੍ਹਾ',
  Blue: 'ਨੀਲਾ',
  Light: 'ਹਲਕਾ',
  'Hindi script': 'ਹਿੰਦੀ ਲਿਪੀ',
  Off: 'ਬੰਦ',
  'Under the tuk': 'ਤੁਕ ਦੇ ਹੇਠਾਂ',
  'Hindi only': 'ਸਿਰਫ਼ ਹਿੰਦੀ',
  Meaning: 'ਅਰਥ',
  English: 'ਅੰਗਰੇਜ਼ੀ',
  'Choose any of them, or none. Hindi shows the Punjabi arth in Hindi script.':
    'ਕੋਈ ਵੀ ਚੁਣੋ, ਜਾਂ ਕੋਈ ਨਹੀਂ। ਹਿੰਦੀ ਵਿੱਚ ਪੰਜਾਬੀ ਅਰਥ ਹਿੰਦੀ ਲਿਪੀ ਵਿੱਚ ਦਿਸਦੇ ਹਨ।',
  'Vishraam colours': 'ਵਿਸ਼ਰਾਮ ਦੇ ਰੰਗ',
  'Larivaar (joined words)': 'ਲੜੀਵਾਰ (ਜੁੜੇ ਸ਼ਬਦ)',
  'Next line in paath and banis': 'ਪਾਠ ਅਤੇ ਬਾਣੀਆਂ ਵਿੱਚ ਅਗਲੀ ਤੁਕ',
  'Source and ang': 'ਸਰੋਤ ਅਤੇ ਅੰਗ',
  Livestream: 'ਲਾਈਵ ਪ੍ਰਸਾਰਣ',
  Copy: 'ਕਾਪੀ ਕਰੋ',
  'Phones and tablets': 'ਫ਼ੋਨ ਅਤੇ ਟੈਬਲੈੱਟ',
  'Let phones on this Wi-Fi follow along': 'ਇਸ Wi-Fi ਉੱਤੇ ਫ਼ੋਨਾਂ ਨੂੰ ਨਾਲ ਚੱਲਣ ਦਿਓ',
  'No Wi-Fi or network connection found on this computer.': 'ਇਸ ਕੰਪਿਊਟਰ ਉੱਤੇ ਕੋਈ Wi-Fi ਜਾਂ ਨੈੱਟਵਰਕ ਕਨੈਕਸ਼ਨ ਨਹੀਂ ਮਿਲਿਆ।',
  'Open this address in the phone browser. The phone must be on the same Wi-Fi as this computer.':
    'ਫ਼ੋਨ ਦੇ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਇਹ ਪਤਾ ਖੋਲ੍ਹੋ। ਫ਼ੋਨ ਇਸ ਕੰਪਿਊਟਰ ਵਾਲੇ Wi-Fi ਉੱਤੇ ਹੀ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
  'Find a shabad': 'ਸ਼ਬਦ ਲੱਭੋ',
  'Gurmukhi words or first letters': 'ਗੁਰਮੁਖੀ ਸ਼ਬਦ ਜਾਂ ਪਹਿਲੇ ਅੱਖਰ',
  'Keep typing…': 'ਹੋਰ ਲਿਖੋ…',
  'Other possible shabads': 'ਹੋਰ ਸੰਭਵ ਸ਼ਬਦ',
  'They appear while listening.': 'ਇਹ ਸੁਣਦੇ ਸਮੇਂ ਦਿਸਦੇ ਹਨ।',
  'None yet.': 'ਅਜੇ ਕੋਈ ਨਹੀਂ।',
  'No match': 'ਕੋਈ ਮੇਲ ਨਹੀਂ',
  '{0} ({1}% match)': '{0} ({1}% ਮੇਲ)',
  'Show this': 'ਇਹ ਦਿਖਾਓ',
  'Show this shabad and keep it until Search again': 'ਇਹ ਸ਼ਬਦ ਦਿਖਾਓ ਅਤੇ ਮੁੜ ਲੱਭੋ ਦਬਾਉਣ ਤੱਕ ਰੱਖੋ',

  // App tab and updates
  Language: 'ਭਾਸ਼ਾ',
  Updates: 'ਅੱਪਡੇਟ',
  'Check for updates when online': 'ਇੰਟਰਨੈੱਟ ਹੋਣ ’ਤੇ ਅੱਪਡੇਟ ਦੀ ਜਾਂਚ ਕਰੋ',
  'Install updates automatically': 'ਅੱਪਡੇਟ ਆਪਣੇ-ਆਪ ਇੰਸਟਾਲ ਕਰੋ',
  'The Microsoft Store keeps Kirtan Saathi up to date.': 'ਮਾਈਕ੍ਰੋਸਾਫ਼ਟ ਸਟੋਰ ਕੀਰਤਨ ਸਾਥੀ ਨੂੰ ਆਪਣੇ-ਆਪ ਨਵਾਂ ਰੱਖਦਾ ਹੈ।',
  'Updates download in the background and install when you close Kirtan Saathi, never during kirtan.':
    'ਅੱਪਡੇਟ ਪਿਛੋਕੜ ਵਿੱਚ ਡਾਊਨਲੋਡ ਹੁੰਦੇ ਹਨ ਅਤੇ ਕੀਰਤਨ ਸਾਥੀ ਬੰਦ ਕਰਨ ’ਤੇ ਇੰਸਟਾਲ ਹੁੰਦੇ ਹਨ, ਕੀਰਤਨ ਦੌਰਾਨ ਕਦੇ ਨਹੀਂ।',
  'This copy of Kirtan Saathi cannot install updates itself. When there is a new version, Download opens the release page.':
    'ਕੀਰਤਨ ਸਾਥੀ ਦੀ ਇਹ ਕਾਪੀ ਆਪ ਅੱਪਡੇਟ ਇੰਸਟਾਲ ਨਹੀਂ ਕਰ ਸਕਦੀ। ਨਵਾਂ ਸੰਸਕਰਣ ਆਉਣ ’ਤੇ ਡਾਊਨਲੋਡ ਰਿਲੀਜ਼ ਵਾਲਾ ਪੰਨਾ ਖੋਲ੍ਹਦਾ ਹੈ।',
  'Check now': 'ਹੁਣੇ ਜਾਂਚੋ',
  'Checking for updates…': 'ਅੱਪਡੇਟ ਦੀ ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ…',
  'You have the latest version.': 'ਤੁਹਾਡੇ ਕੋਲ ਸਭ ਤੋਂ ਨਵਾਂ ਸੰਸਕਰਣ ਹੈ।',
  'Not connected to the internet. Kirtan Saathi checks again when it is.': 'ਇੰਟਰਨੈੱਟ ਨਾਲ ਜੁੜਿਆ ਨਹੀਂ। ਜੁੜਨ ’ਤੇ ਕੀਰਤਨ ਸਾਥੀ ਮੁੜ ਜਾਂਚ ਕਰੇਗਾ।',
  'Version {0} is available.': 'ਸੰਸਕਰਣ {0} ਉਪਲਬਧ ਹੈ।',
  'Downloading version {0}: {1}%': 'ਸੰਸਕਰਣ {0} ਡਾਊਨਲੋਡ ਹੋ ਰਿਹਾ ਹੈ: {1}%',
  'Version {0} is downloaded. It installs when you close Kirtan Saathi.': 'ਸੰਸਕਰਣ {0} ਡਾਊਨਲੋਡ ਹੋ ਗਿਆ ਹੈ। ਕੀਰਤਨ ਸਾਥੀ ਬੰਦ ਕਰਨ ’ਤੇ ਇਹ ਇੰਸਟਾਲ ਹੋਵੇਗਾ।',
  'Could not check for updates: {0}': 'ਅੱਪਡੇਟ ਦੀ ਜਾਂਚ ਨਹੀਂ ਹੋ ਸਕੀ: {0}',
  'Kirtan Saathi {0} is available': 'ਕੀਰਤਨ ਸਾਥੀ {0} ਉਪਲਬਧ ਹੈ',
  'Kirtan Saathi {0} is ready to install': 'ਕੀਰਤਨ ਸਾਥੀ {0} ਇੰਸਟਾਲ ਲਈ ਤਿਆਰ ਹੈ',
  'Update now': 'ਹੁਣੇ ਅੱਪਡੇਟ ਕਰੋ',
  'Restart and update': 'ਮੁੜ ਸ਼ੁਰੂ ਕਰਕੇ ਅੱਪਡੇਟ ਕਰੋ',
  'Downloading {0}%': 'ਡਾਊਨਲੋਡ {0}%',
  Download: 'ਡਾਊਨਲੋਡ',
  Later: 'ਬਾਅਦ ਵਿੱਚ',

  // Technical details
  'Technical details': 'ਤਕਨੀਕੀ ਵੇਰਵੇ',
  'What the recognizer heard (never shown to the sangat):': 'ਪਛਾਣ ਨੇ ਕੀ ਸੁਣਿਆ (ਸੰਗਤ ਨੂੰ ਕਦੇ ਨਹੀਂ ਦਿਖਾਇਆ ਜਾਂਦਾ):',
  Corpus: 'ਗੁਰਬਾਣੀ ਭੰਡਾਰ',
  '{0} lines · {1} shabads': '{0} ਤੁਕਾਂ · {1} ਸ਼ਬਦ',
  'Text source': 'ਪਾਠ ਦਾ ਸਰੋਤ',
  Threads: 'ਥ੍ਰੈੱਡ',
  'Self-test RTF': 'ਸਵੈ-ਜਾਂਚ RTF',
  'Load time': 'ਲੋਡ ਹੋਣ ਦਾ ਸਮਾਂ',
  '{0} s': '{0} ਸਕਿੰਟ',
  Decode: 'ਡੀਕੋਡ',
  '{0} ms for {1} s': '{1} ਸਕਿੰਟ ਲਈ {0} ms',
  Pace: 'ਰਫ਼ਤਾਰ',
  'Last action': 'ਆਖ਼ਰੀ ਕਾਰਵਾਈ',

  // Help when the microphone cannot be used
  'Kirtan Saathi is not allowed to use the microphone. Open System Settings → Privacy & Security → Microphone, turn on Kirtan Saathi, then restart the app.':
    'ਕੀਰਤਨ ਸਾਥੀ ਨੂੰ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਵਰਤਣ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ। System Settings → Privacy & Security → Microphone ਖੋਲ੍ਹੋ, Kirtan Saathi ਚਾਲੂ ਕਰੋ, ਫਿਰ ਐਪ ਮੁੜ ਸ਼ੁਰੂ ਕਰੋ।',
  'Kirtan Saathi is not allowed to use the microphone. Open Settings → Privacy & security → Microphone, turn on "Microphone access" and "Let desktop apps access your microphone", then try again.':
    'ਕੀਰਤਨ ਸਾਥੀ ਨੂੰ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਵਰਤਣ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ। Settings → Privacy & security → Microphone ਖੋਲ੍ਹੋ, "Microphone access" ਅਤੇ "Let desktop apps access your microphone" ਚਾਲੂ ਕਰੋ, ਫਿਰ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  "No microphone was found. Plug in a microphone or the mixer's USB / line input, choose it in the input list, then press Start listening.":
    'ਕੋਈ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਨਹੀਂ ਮਿਲਿਆ। ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਜਾਂ ਮਿਕਸਰ ਦੀ USB / ਲਾਈਨ ਜੋੜੋ, ਇਨਪੁਟ ਦੀ ਸੂਚੀ ਵਿੱਚੋਂ ਚੁਣੋ, ਫਿਰ ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ ਦਬਾਓ।',
  'The microphone is busy or was unplugged. Close other apps using it (Zoom, Skype, OBS audio capture) and try again.':
    'ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਕਿਸੇ ਹੋਰ ਐਪ ਵਿੱਚ ਵਰਤਿਆ ਜਾ ਰਿਹਾ ਹੈ ਜਾਂ ਕੱਢ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਇਸ ਨੂੰ ਵਰਤਣ ਵਾਲੀਆਂ ਹੋਰ ਐਪਾਂ (Zoom, Skype, OBS ਆਡੀਓ) ਬੰਦ ਕਰੋ ਅਤੇ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  'Microphone unavailable: {0}': 'ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਉਪਲਬਧ ਨਹੀਂ: {0}',
  'Could not play file: {0}': 'ਫ਼ਾਈਲ ਨਹੀਂ ਚੱਲ ਸਕੀ: {0}',
};

/** Words with markup (by id), in both languages. */
export const HTML: Record<string, Record<UiLanguage, string>> = {
  guide1: {
    en: '<strong>Choose what is being recited</strong> at the top: kirtan, paath, or a bani.',
    pa: '<strong>ਉੱਪਰੋਂ ਚੁਣੋ ਕਿ ਕੀ ਪੜ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ</strong>: ਕੀਰਤਨ, ਪਾਠ ਜਾਂ ਕੋਈ ਬਾਣੀ।',
  },
  guide2: {
    en: '<strong>Choose the input</strong>: the microphone, or the line from the gurdwara mixer (clearer).',
    pa: '<strong>ਇਨਪੁਟ ਚੁਣੋ</strong>: ਮਾਈਕ੍ਰੋਫ਼ੋਨ, ਜਾਂ ਗੁਰਦੁਆਰੇ ਦੇ ਮਿਕਸਰ ਦੀ ਲਾਈਨ (ਵਧੇਰੇ ਸਾਫ਼)।',
  },
  guide3: {
    en: '<strong>Press Start listening.</strong> The shabad appears here within a few seconds and follows along. Click any line to show it yourself.',
    pa: '<strong>ਸੁਣਨਾ ਸ਼ੁਰੂ ਕਰੋ ਦਬਾਓ।</strong> ਕੁਝ ਸਕਿੰਟਾਂ ਵਿੱਚ ਸ਼ਬਦ ਇੱਥੇ ਆ ਜਾਂਦਾ ਹੈ ਅਤੇ ਨਾਲ-ਨਾਲ ਚੱਲਦਾ ਹੈ। ਕੋਈ ਤੁਕ ਆਪ ਦਿਖਾਉਣ ਲਈ ਉਸ ਉੱਤੇ ਕਲਿੱਕ ਕਰੋ।',
  },
  waheguru: {
    en: '<span lang="pa">ਵਾਹਿਗੁਰੂ</span> while searching',
    pa: 'ਸ਼ਬਦ ਲੱਭਣ ਵੇਲੇ <span lang="pa">ਵਾਹਿਗੁਰੂ</span>',
  },
  livestream: {
    en: 'In OBS, add a <em>Browser</em> source with this address, size 1920 × 1080. The background stays transparent.',
    pa: 'OBS ਵਿੱਚ ਇਸ ਪਤੇ ਨਾਲ <em>Browser</em> source ਜੋੜੋ, ਆਕਾਰ 1920 × 1080। ਪਿਛੋਕੜ ਪਾਰਦਰਸ਼ੀ ਰਹਿੰਦਾ ਹੈ।',
  },
  'first-letters': {
    en: 'Type words, e.g. <span lang="pa">ਪੋਥੀ ਪਰਮੇਸਰ</span>, or the first letter of each word: <span lang="pa">ਪਪਕਥ</span>, or <kbd>ppkQ</kbd> with the Gurbani Akhar keys.',
    pa: 'ਸ਼ਬਦ ਲਿਖੋ, ਜਿਵੇਂ <span lang="pa">ਪੋਥੀ ਪਰਮੇਸਰ</span>, ਜਾਂ ਹਰ ਸ਼ਬਦ ਦਾ ਪਹਿਲਾ ਅੱਖਰ: <span lang="pa">ਪਪਕਥ</span>, ਜਾਂ ਗੁਰਬਾਣੀ ਅੱਖਰ ਕੀਬੋਰਡ ਨਾਲ <kbd>ppkQ</kbd>।',
  },
};

/** `text` in `language`; {0}, {1}… are replaced by `args`. */
export function translate(language: UiLanguage, text: string, ...args: (string | number)[]): string {
  const s = language === 'pa' ? PA[text] ?? text : text;
  return s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}
