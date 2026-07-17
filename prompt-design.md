# Claude Design Prompt: Redesign the UI for Paktyur! 🎉

You are redesigning the UI/UX of an existing web application. The codebase already exists and is open in your workspace. **Do not rewrite the application's functionality or architecture unless necessary for the new UI.** Focus on creating a polished, delightful, modern interface while preserving the existing behavior.

## Project Overview

The application is called **Paktyur!**

"Paktyur!" is a Filipino colloquial pronunciation of the English word "Picture!" and is commonly shouted when someone is about to take a photo. It conveys excitement and encourages everyone to smile before the camera clicks.

The application is a **fun, browser-based photo booth** that guides users through taking photos and generating a printable photo strip.

The experience should feel like:

* A modern photo booth
* Fun and energetic
* Colorful without being childish
* Friendly and welcoming
* Social-media ready
* Mobile-first but equally polished on desktop

The UI should make users smile before they even start taking pictures.

---

# Visual Direction

## Theme

Think of a mix of:

* Japanese/Korean photo booth kiosks
* Fun arcade machines
* Bright pastel gradients
* Confetti
* Rounded cards
* Soft shadows
* Cute stickers
* Camera-inspired UI
* Playful animations
* Polaroid aesthetics

The interface should feel premium, not cheap.

Avoid:

* Generic Bootstrap appearance
* Corporate dashboard styling
* Flat boring layouts
* Heavy dark themes

---

# Typography

The title **Paktyur!** should immediately become the personality of the app.

Use a playful display font for the title such as:

* Baloo 2
* Fredoka
* Lilita One
* Luckiest Guy
* Titan One
* Bungee
* Any similarly fun Google Font

The rest of the interface should use a clean sans-serif such as:

* Inter
* Nunito
* Poppins
* Manrope

Maintain excellent readability.

---

# Color Palette

Suggested palette:

Primary:

* Coral (#FF6B6B)

Secondary:

* Sunny Yellow (#FFD93D)

Accent:

* Aqua (#6FE7DD)

Support:

* Lavender (#BFA2FF)

Background:

* Warm White (#FFFDF9)

Use gradients where appropriate.

Buttons should feel vibrant.

Cards should have soft rounded corners (16–24px).

---

# Animation

Introduce tasteful motion throughout the experience.

Examples:

* Fade transitions between steps
* Progress indicator animation
* Floating decorative elements
* Camera flash effect
* Countdown animation
* Success confetti after completion
* Loading shimmer while processing
* Hover animations
* Button press feedback

Animations should enhance the experience without slowing it down.

---

# Overall Flow

The application is a guided step-by-step wizard.

Display a clear progress indicator across the top.

Example:

Welcome → Template → Preview → Capture → Processing → Result

Users should always know what step they are on.

---

# Step 1 — Welcome

Purpose:
Introduce the application and encourage users to start.

Large hero section containing:

* Large Paktyur! title
* Fun subtitle
* Illustration or camera-themed graphics
* Brief explanation of what the app does

Suggested messaging:

"Smile, strike a pose, and create your own photo strip in minutes!"

Primary CTA:

**📸 Take a Picture Now**

Secondary supporting text:

"Choose a template, capture your moments, and download your personalized photo strip."

---

# Step 2 — Choose Template

Allow users to:

* Select an existing template
  OR
* Upload their own template

Display templates as large visual cards.

Each card should have:

* Preview image
* Name
* Select button

Upload area should support drag-and-drop.

Clearly highlight the selected template.

---

# Step 3 — Preview Template

Show:

* Large preview of the chosen template

Overlay all photo placeholders clearly.

Explain:

"These highlighted areas will be filled with the photos you'll take."

Display preparation instructions.

Examples:

* Make sure everyone fits in the frame.
* Good lighting gives the best results.
* Have fun!

Large CTA:

**Start Taking Photos**

---

# Step 4 — Capture Photos

This is the most important screen.

Layout:

Large camera preview.

Progress indicator:

Photo 1 of 4

Photo 2 of 4

etc.

Display remaining photo slots visually.

Keep the interface uncluttered.

---

## Step 4.1 — Trigger Instructions

Depending on configuration, instruct users to either:

**Say "Cheese!"**

OR

**Make a ✌️ V hand gesture**

Display this instruction prominently with fun illustrations or icons.

Users should clearly understand how to trigger the shutter.

---

## Step 4.2 — Countdown

Before each capture:

Display a large animated countdown:

3

2

1

📸

Countdown should be exciting.

Include a subtle camera flash animation when the photo is taken.

After each successful shot:

Animate the corresponding placeholder filling in.

Celebrate each captured image with a satisfying visual effect.

---

# Step 5 — Processing

Once all photos are captured:

Display:

🎉 Great job!

Your photo strip is being processed.

Show:

* Animated loading indicator
* Progress animation
* Fun processing messages that rotate, such as:

  * Developing your masterpiece...
  * Adding the magic...
  * Almost ready...
  * Making everyone look amazing...

This screen should reassure users that processing is happening.

---

# Step 6 — Finished

Display the completed photo strip prominently.

Allow users to admire the result before deciding what to do next.

Primary actions:

* 📸 Take Another Photo (same template)
* 🎨 Choose a New Template

Also include a section encouraging sharing.

Example:

## Invite your friends!

"Enjoyed Paktyur? Share it so your friends can create their own photo strips too!"

Provide a prominent CTA:

**📋 Copy Website Link**

When clicked:

* Copy the current site URL
* Display a friendly success message such as:
  "Link copied! Share the fun! 🎉"

---

# Components

Use reusable modern UI components throughout:

* Rounded buttons
* Floating action buttons where appropriate
* Progress stepper
* Toast notifications
* Modal dialogs
* Glassmorphism accents (used sparingly)
* Beautiful upload zone
* Loading skeletons
* Empty states
* Success states

---

# Responsive Design

The application must work beautifully on:

* Mobile phones
* Tablets
* Desktop
* Large monitors

Buttons should remain comfortably tappable.

The camera experience should prioritize available screen space.

---

# Accessibility

Ensure:

* Excellent color contrast
* Keyboard accessibility
* Focus indicators
* Large touch targets
* Responsive text scaling
* ARIA labels where applicable

---

# Technical Guidance

* Preserve the existing application logic and workflows.
* Prioritize refactoring styles and component structure over changing business logic.
* Reuse existing components where possible, improving their visual presentation.
* Maintain clean, reusable, and consistent styling.
* Keep animations performant.
* Use modern CSS techniques (Flexbox/Grid, CSS variables, transitions) where appropriate.
* Avoid introducing unnecessary dependencies solely for styling.

---

# Overall Goal

Transform the existing application into a delightful, polished, memorable photo booth experience that immediately communicates fun, excitement, and personality. Every step should feel engaging and intuitive, encouraging users to smile, interact naturally, and share the experience with friends. The redesigned interface should be visually cohesive, playful without feeling childish, and memorable enough that users will want to come back and invite others to try **Paktyur!**

This prompt is designed to give Claude Design enough creative freedom while clearly preserving the existing application's functionality and workflow.
