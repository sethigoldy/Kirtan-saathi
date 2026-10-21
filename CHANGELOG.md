# Changelog

What changed in each release. When a version is released, its section becomes the *What's new* part of the GitHub release, and the app shows the same list when it offers the update. The release workflow does not publish a version without a section here.

## 0.4.1

- **Start listening works on every Windows PC.** On a PC without the Microsoft Visual C++ Redistributable, Start listening stopped with "The specified module could not be found". Kirtan Saathi now brings the files it needs with it.

## 0.4.0

- **New shabads are found by themselves.** When the ragis start a new shabad, Kirtan Saathi now moves to it without Search again, also on slower computers. If it cannot tell what is being sung, it shows ਵਾਹਿਗੁਰੂ instead of keeping the old shabad on screen.
- **Microsoft Store.** On Windows, Kirtan Saathi can also be installed from the Microsoft Store once Microsoft has approved it: no security warning, and the Store keeps it up to date.

## 0.3.0

- **English meaning.** Show the English translation under the tuk, alone or with the Punjabi arth or its Hindi-script version (Screen → Meaning). Each source is credited on screen, e.g. Translation: Dr. Sant Singh Khalsa.
- **Kirtan Saathi in Punjabi.** App → Language → ਪੰਜਾਬੀ puts the app's buttons and messages in Punjabi, along with the source line on every screen (ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ · ਰਾਗੁ ਸੋਰਠਿ · ਅੰਗ ੬੨੮) and the phone page. Gurbani and the meanings are unchanged.
- **Meaning on phones.** A reader's own meaning choice on the phone page now shows even when the projector shows no meaning.
- **New icon.** An open pothi with the sound of the recitation rising from it. In the app, the sound moves while Kirtan Saathi is listening.

## 0.2.0

- **Update notices.** When the computer is online, Kirtan Saathi checks for a new version and shows what changed. On Windows it can update itself: press Update now, or turn on Install updates automatically (under App). Updates install when you close the app, never during kirtan.
- **ਵਾਹਿਗੁਰੂ while searching.** The projector and livestream show ਵਾਹਿਗੁਰੂ instead of an empty screen until the shabad is found. Turn it off under Screen → ਵਾਹਿਗੁਰੂ while searching.
- **Hindi at full size.** With Hindi under the tuk, the Hindi line is the same size as the Gurmukhi. Only the meaning is smaller.
- **Steadier lines.** The line on screen changes only when Kirtan Saathi is at least 60% sure; otherwise the current line stays.
- **Switching the microphone** while listening now works.
- **Find.** A shabad chosen in Find, a clicked line, and Next / Previous now show in your own shabad list too.
- **Bani mode** starts on Japji Sahib again.

## 0.1.0

- First release: live shabad detection and line following for kirtan, paath and banis, with projector, livestream overlay and phone outputs.
