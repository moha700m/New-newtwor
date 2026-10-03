# Shortcut Forge v2

React/Vite rewrite of Shortcut Forge using a production-oriented UI stack.

## Stack
- React + TypeScript + Vite
- Tailwind CSS 4
- dnd-kit (`@dnd-kit/react`) for sortable workflow actions
- Zustand with local persistence
- Zod validation
- Lucide icons
- Motion for deliberate entrance animation
- shadcn-compatible source-component approach / Base UI dependency available for future dialogs and overlays

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Security model
The web app generates Shortcut plist XML and an unsigned `.shortcut` download. Public Apple-compatible distribution signing must be performed on macOS using Apple's `shortcuts sign` command. The site does not claim silent installation or bypass Apple permission prompts.