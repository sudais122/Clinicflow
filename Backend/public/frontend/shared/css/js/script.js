// Navbar border on scroll
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// FAQ accordion — only one open at a time
const faqItems = document.querySelectorAll(".faq-item");
faqItems.forEach((item) => {
  const q = item.querySelector(".faq-q");
  const a = item.querySelector(".faq-a");
  q.addEventListener("click", () => {
    const isOpen = item.classList.contains("open");

    // Close all items first
    faqItems.forEach((other) => {
      other.classList.remove("open");
      other.querySelector(".faq-a").style.maxHeight = 0;
    });

    // Open the clicked one only if it was closed
    if (!isOpen) {
      item.classList.add("open");
      a.style.maxHeight = a.scrollHeight + "px";
    }
  });
});

// Live queue simulation (signature element)
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const nowNum = document.getElementById("nowNum");
const nowToken = document.getElementById("nowToken");
const aheadN = document.getElementById("aheadN");
const waitN = document.getElementById("waitN");
const clinicState = document.getElementById("clinicState");
const yourToken = 22;
const perPatient = 10;
let serving = 18;

function render() {
  nowNum.textContent = serving;
  const ahead = Math.max(yourToken - serving - 1, 0);
  aheadN.textContent = ahead;
  waitN.textContent = ahead === 0 ? "Now" : ahead * perPatient + " min";

  document.querySelectorAll("#tokens .tok").forEach((tok) => {
    const n = parseInt(
      tok.querySelector(".tn").textContent.replace("#", ""),
      10,
    );
    tok.classList.remove("served", "turn");
    const ts = tok.querySelector(".ts");
    if (n <= serving) {
      if (n === yourToken) {
        tok.classList.add("turn");
        ts.textContent = "your turn";
      } else {
        tok.classList.add("served");
        ts.textContent = "served";
      }
    } else if (n === yourToken) {
      ts.textContent = "you";
    } else {
      ts.textContent = "waiting";
    }
  });

  if (serving >= yourToken) {
    clinicState.textContent = "It's you";
  }
}
render();

if (!reduce) {
  setInterval(() => {
    serving = serving >= yourToken ? 18 : serving + 1; // advance, then loop
    if (serving === 18) {
      clinicState.textContent = "Open";
      clinicState.style.color = "var(--green)";
    }
    nowToken.classList.remove("pulse");
    void nowToken.offsetWidth;
    nowToken.classList.add("pulse");
    render();
  }, 2600);
}

// Scroll reveal
const revealEls = document.querySelectorAll("[data-reveal]");
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        io.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.7, rootMargin: "0px 0px -60px 0px" },
);
revealEls.forEach((el) => io.observe(el));


const menuBtn = document.getElementById("menuBtn");
const mobileMenu = document.getElementById("mobileMenu");

menuBtn.addEventListener("click", () => {
  const open = menuBtn.classList.toggle("open");
  mobileMenu.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", open);
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuBtn.classList.remove("open");
    mobileMenu.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  });
});