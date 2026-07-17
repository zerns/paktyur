# Prompt: Build a Client-Side Photo Booth Web Application Using PNG/JPG Templates

Build a production-quality **client-side web application** using **HTML5, CSS3, and vanilla JavaScript (ES2022+) only**. Do **not** use any backend, frameworks, or external JavaScript libraries unless absolutely necessary. The application must run entirely inside the browser.

The application generates a composite image by placing camera photos into placeholder regions found in an uploaded template image.

The application shall support both **PNG** (transparent placeholders) and **JPG/JPEG** (color-based placeholders).

---

# General Requirements

* Pure HTML, CSS, and JavaScript.
* Responsive desktop-first UI that also works well on tablets.
* Modular JavaScript using ES Modules.
* Clear separation of concerns.
* Use async/await for asynchronous operations.
* Keep the UI responsive during image processing.
* Follow modern JavaScript best practices.
* Comprehensive error handling.
* User-friendly progress indicators.
* Simple, clean, intuitive UI.

---

# Performance & Memory Management

Follow JavaScript image-processing best practices.

* Decode images asynchronously.
* Use `createImageBitmap()` whenever appropriate.
* Use `OffscreenCanvas` when supported.
* Avoid unnecessary redraws.
* Avoid unnecessary image copies.
* Reuse canvases whenever practical.
* Close ImageBitmap objects after use.
* Revoke Object URLs.
* Clear temporary canvases.
* Stop camera streams when no longer needed.
* Stop microphone streams when finished.
* Remove unused event listeners.
* Release references to large objects.
* Use asynchronous processing to keep the UI responsive.

---

# Application Flow

---

# Step 1 – Upload Template

Allow the user to upload a template.

Supported formats:

* PNG
* JPG
* JPEG

After upload:

* Validate the file.
* Decode efficiently.
* Display a preview.
* Automatically determine the image type.

---

# Step 2 – Validate Template Dimensions

Verify the uploaded image does not exceed configured limits.

Example:

```js
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;
```

If validation fails:

* Display an informative error.
* Stop processing.

---

# Step 3 – Detect Photo Placeholders

## PNG Templates

Detect placeholders using transparency.

Requirements:

* Scan the alpha channel.
* Detect connected transparent regions.
* Ignore transparent regions connected to the image border.
* Remaining connected regions become candidate placeholders.

Use Connected Component Labeling using Flood Fill, BFS or DFS.

---

## JPG/JPEG Templates

Since JPEG images have no transparency, allow the user to define the placeholder color.

Workflow:

1. Display the uploaded template.
2. Ask the user to click a placeholder color.
3. Show a magnified preview around the cursor.
4. Store the selected RGB value.
5. Allow the user to adjust a color tolerance slider.

Example:

```js
const DEFAULT_COLOR_TOLERANCE = 15;
```

After the color is selected:

* Scan the image.
* Detect connected regions matching the selected color within tolerance.
* Ignore border-connected regions.
* Remaining connected regions become candidate placeholders.

---

# Placeholder Validation

Every detected region must satisfy configurable limits.

Example:

```js
const MIN_PLACEHOLDER_WIDTH = 150;
const MIN_PLACEHOLDER_HEIGHT = 150;
const MIN_PLACEHOLDER_AREA = 25000;

const MAX_PLACEHOLDER_WIDTH = 1500;
const MAX_PLACEHOLDER_HEIGHT = 1500;
const MAX_PLACEHOLDER_AREA = 600000;
```

Each placeholder must satisfy:

* Width ≥ minimum width
* Height ≥ minimum height
* Area ≥ minimum area
* Width ≤ maximum width
* Height ≤ maximum height
* Area ≤ maximum area

Store:

```js
{
    id,
    x,
    y,
    width,
    height,
    centerX,
    centerY,
    area,
    pixelCount
}
```

Rejected placeholders should include:

```js
{
    id,
    reason,
    width,
    height,
    area
}
```

Sort valid placeholders:

1. Top → Bottom
2. Left → Right

---

# Step 4 – Placeholder Preview & Confirmation

Before the photo session begins, display the uploaded template with an overlay highlighting every detected placeholder.

Each placeholder should display:

* Colored outline
* Semi-transparent overlay
* Sequence number (1, 2, 3…)

Display a summary:

* Total detected regions
* Valid placeholders
* Rejected placeholders
* Reasons for rejection

Allow the user to:

* Confirm detection
* Cancel and upload another template
* (For JPG) Choose another placeholder color
* Adjust color tolerance
* Rerun placeholder detection

Do not continue until the user confirms the detected placeholders.

---

# Step 5 – Validate Placeholder Count

Only valid placeholders are counted.

Example:

```js
const MIN_PHOTOS = 1;
const MAX_PHOTOS = 8;
```

If:

* Valid placeholders < MIN_PHOTOS
* Valid placeholders > MAX_PHOTOS

Display an error showing:

* Number of valid placeholders
* Number rejected
* Reasons
* Minimum required
* Maximum allowed

Stop processing.

---

# Step 6 – Prepare Photo Session

When validation succeeds:

Display:

> Prepare for your photo session.

Display:

> This template requires **X** photos.

Display progress:

```
Photo 1 of X
```

When the application first loads, immediately request permission for:

* Camera
* Microphone

Display:

* Camera status
* Microphone status

Display the live camera preview.

Do not continue until camera access is available.

If microphone access is unavailable, automatically switch to gesture mode.

---

# Step 7 – Hands-Free Capture Trigger

The application supports two capture methods.

## Voice Trigger

Prompt:

> Say "Cheese"

Use:

* SpeechRecognition
* webkitSpeechRecognition

Requirements:

* Continuous listening
* Case-insensitive detection
* Ignore unrelated speech
* Configurable timeout
* Retry if timeout occurs

---

## Gesture Trigger (Fallback)

If:

* No microphone exists
* Microphone permission denied
* Speech recognition unavailable

Automatically switch to gesture mode.

Prompt:

> Show a ✌️ hand sign to begin.

Implement client-side hand tracking.

Preferred implementation:

* MediaPipe Tasks Vision (Hand Landmarker) running locally in the browser.

Detect:

* One visible hand
* Index finger raised
* Middle finger raised
* Ring finger folded
* Pinky folded
* Thumb folded or not extended

Require the gesture to remain stable for approximately one second.

Provide visual feedback:

```
Waiting for ✌️
```

When detected:

```
Gesture detected!
```

Prevent repeated triggering by using a cooldown timer.

---

# Step 8 – Countdown

After voice or gesture detection:

Display a fullscreen animated countdown:

```
3

2

1

CLICK!
```

Optionally play a shutter sound.

---

# Step 9 – Capture Photo

Capture one frame from the camera.

Assign it sequentially.

* Photo 1 → Placeholder 1
* Photo 2 → Placeholder 2
* etc.

The captured image must:

* Preserve aspect ratio
* Fill the placeholder completely
* Be center aligned horizontally
* Be center aligned vertically
* Crop excess portions
* Never stretch

Equivalent to:

```css
object-fit: cover;
object-position: center;
```

Use an OffscreenCanvas before compositing whenever supported.

---

# Step 10 – Continue Session

If additional placeholders remain:

Display:

```
Prepare for the next photo.
```

Highlight only the next placeholder while dimming the others.

Display:

```
Photo 3 of 6
```

Return to Step 7.

Repeat until every placeholder has been filled.

---

# Step 11 – Processing Screen

Display:

```
Processing your photo...

Please wait...
```

Perform rendering asynchronously.

Do not block the UI.

---

# Step 12 – Final Output

Display the completed composite image.

Provide buttons:

* Download PNG
* Print
* Take another photo using same template
* Upload another template

If using the same template:

* Reuse detected placeholders.
* Skip placeholder detection.
* Restart photo capture.

If uploading another template:

* Release all resources.
* Clear caches.
* Restart from Step 1.

---

# Image Processing Pipeline

Implement the following workflow:

1. Decode image
2. Validate dimensions
3. Detect placeholders
4. Validate placeholder sizes
5. Sort placeholders
6. Display preview overlay
7. Wait for user confirmation
8. Validate placeholder count
9. Capture photos
10. Crop images
11. Composite final image
12. Export PNG

Cache placeholder information for reuse.

Avoid rescanning the template unnecessarily.

---

# Camera Requirements

Use:

```js
navigator.mediaDevices.getUserMedia()
```

Preferred constraints:

* Front-facing camera
* HD resolution

Allow switching cameras if multiple are available.

---

# Printing

Provide a print-friendly layout.

Hide unnecessary controls while printing.

---

# Error Handling

Gracefully handle:

* Invalid template
* Corrupted image
* Unsupported format
* Oversized image
* Camera unavailable
* Camera permission denied
* Microphone unavailable
* Microphone permission denied
* Speech recognition unavailable
* Gesture detection unavailable
* Browser incompatibility
* Placeholder detection failure
* Placeholder too small
* Placeholder too large
* Too few placeholders
* Too many placeholders
* Capture failure
* Rendering failure

Provide meaningful error messages and retry options.

---

# Browser Compatibility

Primary target:

* Google Chrome

Also support:

* Microsoft Edge
* Firefox (where supported)
* Safari with graceful degradation

---

# Deliverables

Generate a complete project with the following structure:

```text
/index.html
/styles.css
/js/
    app.js
    camera.js
    microphone.js
    gesture.js
    placeholderDetector.js
    imageProcessor.js
    ui.js
    utils.js
```

The code should be modular, well-documented, maintainable, and production-ready.

Use modern JavaScript best practices, asynchronous APIs where appropriate, optimize for performance and memory usage, and maintain a clear separation of responsibilities between modules.

Finally, include a concise `README.md` explaining:

* How the placeholder detection works for both PNG and JPG/JPEG templates.
* How to configure placeholder size limits and color tolerance.
* Browser compatibility notes.
* How the voice and gesture capture modes work.
* Any permissions required (camera, microphone) and fallback behavior.
* A mermaid diagram on the flow
