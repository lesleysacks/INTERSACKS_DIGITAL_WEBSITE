# Reusable Greeting Card Templates

This directory contains two self-contained, reusable HTML greeting cards:

- `birthday-card-template.html` — an elegant two-page birthday flip card.
- `valentine-card-template.html` — a friendly Valentine card with two accessible responses and an optional photo.

Both templates work offline, require no server, backend, API, external library, or external image, and store or transmit no visitor information.

## Preview and download

Open either HTML file directly in a browser to preview it. From the InterSacks Digital Work page, **Preview template** opens that same source file in a new tab and **Download template** downloads it for customization.

## Customize a card

Open the downloaded HTML file in a text editor. Near the end of each file, find the clearly labelled `CARD_CONFIG` object. Edit only the values in that object; the script safely assigns visible wording with `textContent` rather than `innerHTML`.

The birthday configuration covers the page title, occasion label, recipient, monogram, cover and inside headings, salutation, message paragraphs, and signature. The Valentine configuration covers the page title, recipient, optional photo URL and alternative text, question, button labels, both responses, and signature.

To use a Valentine photo, set `photoUrl` to a local relative file path or an HTTPS URL and provide useful `photoAlt` text. If the URL is blank or cannot load, the template displays a safe decorative placeholder. Do not commit personal, confidential, or copyrighted images to a public repository without the subject's permission and the necessary usage rights.

## Publish a customized copy with GitHub Pages

1. Create a repository and add your customized HTML file.
2. Rename it to `index.html` if it should be the site's home page.
3. In the repository settings, enable GitHub Pages from the branch containing the file.
4. Review the published page and confirm that no private wording or images were included accidentally.

Keep the MIT copyright and permission notice inside the HTML comment when copying or publishing a template.

## Accessibility

Both cards use semantic HTML, keyboard-operable controls, visible focus indicators, polite live status messages, responsive layouts, and reduced-motion alternatives. The Valentine choices remain available at all times; neither button evades the pointer or keyboard.

## Known limitations

- The cards do not include a visual editor; customization is made in `CARD_CONFIG`.
- Remote photo URLs require a network connection and may be blocked by their host. Local images must be kept beside the customized card using the correct relative path.
- Browser and operating-system motion preferences determine whether celebration animation runs.
- These are static cards and do not send responses to another person.

## Licence scope

Files inside `assets/templates/greeting-cards/` are licensed under the included MIT License, copyright 2026 Lesley Sacks. This directory-level licence does **not** automatically license the rest of the InterSacks Digital website, its brand, project images, or unrelated content.
