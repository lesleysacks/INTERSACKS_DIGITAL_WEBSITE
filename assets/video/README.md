# Motion video slots

Place exported MP4 motion reels in this folder, then add a matching `source` element inside the relevant `video` tag. Keep every clip short, muted, and loopable for the best on-page experience.

Example:

```html
<video autoplay muted loop playsinline poster="images/business_card.jpeg">
  <source src="assets/video/northstar-reel.mp4" type="video/mp4">
</video>
```

The existing slots intentionally have no source yet, so their branded placeholder remains visible until the final media is supplied.
