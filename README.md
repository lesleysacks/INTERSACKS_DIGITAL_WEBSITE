# Lesley Sacks — Professional Portfolio Website

A premium, handcrafted developer portfolio website designed for full-stack web developer Lesley Sacks. Built with high-fidelity aesthetics, modern accessibility practices, and responsive vanilla web technologies.

## 🚀 Project Overview

This website serves as a premium digital storefront for Lesley Sacks, a web developer based in Paarl, South Africa. It highlights skills across frontend (React, JavaScript) and backend (Python, Django) development, showcases region-focused client work, features a professional background timeline, gathers client reviews, and offers an accessible project request interface.

---

## ✨ Features

- **Premium Aesthetics:** Dark/light mode switcher with persistent localStorage savings, gradient overlays, and dynamic glassmorphism.
- **Micro-Animations:** Fluid scroll-reveal transitions and interactive skill progress indicators driven by high-performance `IntersectionObserver` elements.
- **Handcrafted Responsive Grid:** A mobile-first design adapted for phones, tablets, laptops, and large screens.
- **Client-Side Form Validation:** Dynamic, real-time error validation on the contact form with custom, user-friendly messages.
- **Accessible & Semantic HTML5:** Structured with semantic landmarks, keyboard focus states, alt attributes, and high text contrasts.
- **SEO Ready:** Complete metadata, description tags, canonical definitions, responsive viewports, Open Graph integrations, and a dynamic fallback SVG favicon.

---

## 📂 Folder Structure

The project code is organized cleanly into modular, separate files:

```
project/
├── index.html         # Main semantic structure and SEO tagging
├── css/
│      styles.css      # Custom variables, resets, layout grids, components, and animations
├── js/
│      script.js       # Modular scripts (theme state, scroll tracking, validation checks)
├── images/
│      profile_pic.jpg # Lesley's profile picture
├── icons/             # (Optional) SVG/PNG icons
├── assets/
│      L.S CV 2026.pdf # Resumes and other static downloads
└── README.md          # Technical documentation
```

---

## 💻 How to Run Locally

Since this is a static, vanilla web application (HTML5, CSS3, and ES6+ JavaScript), it does not require complex build tools or compilers.

### Option 1: Double-Click File
Simply navigate to the project directory and open `index.html` in any modern web browser.

### Option 2: Live Server (Recommended)
Using a local dev server avoids security restrictions for file system routing and provides hot-reloads:
1. Open VS Code in the project folder.
2. Install the **Live Server** extension.
3. Click **"Go Live"** in the bottom right corner of the window.

Alternatively, spin up a simple server via Python in your terminal:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000` in your web browser.

---

## 🛠️ Customization Guide

### Changing Themes & Color Palettes
The style guide is managed using CSS Custom Properties located at the top of `css/styles.css`. You can alter colors for both Dark and Light themes by modifying their hex/RGB values:

```css
:root {
  /* Primary accents */
  --teal: #0ABFBC;
  --teal-dark: #089A97;

  /* Dark mode background/surfaces */
  --bg: #0E1117;
  --bg2: #141820;
  --surface: #1F2535;
  --text: #EEF0F7;
}

[data-theme="light"] {
  /* Light mode background/surfaces */
  --bg: #F5F7FF;
  --bg2: #ECEEF8;
  --surface: #FFFFFF;
  --text: #2D3352;
}
```

### Adding New Project Cards
To add or modify portfolio projects, copy a project grid item inside `<div class="projects-grid">` in `index.html`:

```html
<div class="project-card reveal">
  <div class="project-img">
    <!-- Place a CSS-styled visual mockup or a standard img tag -->
  </div>
  <div class="project-body">
    <div class="proj-tags">
      <span class="proj-tag tag-react">React</span>
    </div>
    <h3>New Project Title</h3>
    <p>Describe the client, purpose, and technologies used.</p>
    <div class="proj-footer">
      <div class="proj-client">Client: <strong>Name</strong></div>
      <a href="#" class="proj-link">View Details →</a>
    </div>
  </div>
</div>
```

---

## 🌐 Browser Support

Works on all modern evergreen browsers with standard ES6+ and CSS variables:
- Google Chrome (Latest)
- Mozilla Firefox (Latest)
- Apple Safari (Latest)
- Microsoft Edge (Latest)

---

## 💎 Credits

- **Fonts:** [Google Fonts](https://fonts.google.com/) (Syne & DM Sans)
- **Developer & Creator:** Lesley Sacks
- **Refactoring & Modernization:** Antigravity (Google DeepMind team)
