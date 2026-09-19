const product = {
  growth: ["Orbit Growth", "Performance, goals, check-ins and career conversations—connected around meaningful progress."],
  competency: ["Competency Management", "A shared language for capability, role expectations and development choices."],
};
const productKey = new URLSearchParams(location.search).get("product");
const selected = product[productKey] || [
  "A new Orbit product",
  "This Orbit product is being built to work beautifully with the rest of your people system.",
];
document.querySelector("#product-name").textContent = selected[0];
document.querySelector("#product-copy").textContent = selected[1];
document.title = `Orbit | ${selected[0]} — Coming soon`;

// Carry the specific product through to the demo form so it can be
// pre-selected there instead of dropping the visitor on a blank form.
if (product[productKey]) {
  const talkToOrbit = document.querySelector("#talk-to-orbit");
  talkToOrbit.href = `/orbit-360/corporate.html?product=${encodeURIComponent(productKey)}#demo`;
}
