const fontToggle = document.querySelector("#font-toggle");

// Font options to cycle through
const fonts = ["retro", "jetbrains", "ibm", "space"];
const fontNames = {
  jetbrains: "JetBrains Mono",
  ibm: "IBM Plex Mono",
  space: "Space Mono",
  retro: "Press Start 2P"
};

function switchFont() {
  const current = document.documentElement.getAttribute("data-font") || "jetbrains";
  const currentIndex = fonts.indexOf(current);
  const nextIndex = (currentIndex + 1) % fonts.length;
  const nextFont = fonts[nextIndex];

  document.documentElement.setAttribute("data-font", nextFont);
  localStorage.setItem("font", nextFont);
}

fontToggle.addEventListener("click", switchFont, false);