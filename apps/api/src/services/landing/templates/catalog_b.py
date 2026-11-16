"""Templates 9-15: kids learning, nonprofit, cohort course, membership
community, B2B partner academy, art & design school and certification body."""

from __future__ import annotations

from src.services.landing.recipes import el
from src.services.landing.templates.kit import (
    anim, art, box, btn, cols, courses, divider, eyebrow, feature, h, heading_group, img, page, row, section, stat, t, theme,
)


def _org(ctx: dict, fallback: str) -> str:
    return (ctx.get("org_name") or "").strip() or fallback


# ─── 9. Kids learning ─────────────────────────────────────────────────────────


def kids(ctx: dict) -> dict:
    org = _org(ctx, "our school")
    th = theme(primary="#ff6f61", secondary="#2b3a67", accent="#ffc93c", background="#fffdf8", surface="#e8f4ff", text="#22304f",
               muted="#5d6a86", border="#dde9f7", heading="Quicksand", body="Nunito", radius="full", button="pill", weight="700")
    hero = section([
        cols([
            box([
                row([t("Ages 6–12 · Learn through play", base={"fontWeight": "800", "fontSize": 14, "color": "#b4540a", "backgroundColor": "#fff1c7", "paddingTop": 8, "paddingBottom": 8,
                                                              "paddingLeft": 16, "paddingRight": 16, "borderRadius": 999})]),
                h("Curious kids learn best when it feels like play.", 1, base={"fontSize": "4.2rem", "lineHeight": 1.05, "letterSpacing": "-0.02em"}, tablet={"fontSize": "3.3rem"}, mobile={"fontSize": "2.5rem"}, animation=anim("zoom")),
                t("Short, joyful lessons in reading, maths, science and art, made by teachers and loved by children. Parents see every step; kids just see adventures.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.65, "color": "$muted", "maxWidth": "520px"}),
                row([btn("Try a free week", "/signup", icon="Star"), btn("For parents", "#parents", "secondary")], gap=12, mobile={"flexDirection": "column", "alignItems": "stretch"}),
            ], base={"gap": 24}),
            img(art("kids-hero"), "A friendly sun, a paper plane and colourful building blocks", animation=anim("zoom", 150, 900)),
        ], ratio="equal", gap=48),
    ], name="Hero", base={"backgroundColor": "$surface"}, pad=(80, 96))

    subjects = section([
        heading_group("What we learn", "Four worlds to explore", align="center"),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 20}, "tablet": {"gridColumns": 2}, "mobile": {"gridColumns": 1}}, [
            box([t(e, base={"fontSize": 44, "lineHeight": 1}), h(ti, 3, base={"fontSize": "1.35rem"}), t(tx, base={"color": "$muted", "fontSize": 15, "lineHeight": 1.6})],
                base={"gap": 12, "paddingTop": 28, "paddingBottom": 28, "paddingLeft": 24, "paddingRight": 24, "borderRadius": 28, "backgroundColor": bg},
                hover={"scale": 1.03})
            for e, ti, tx, bg in (("📚", "Reading", "Phonics, stories and the joy of a first chapter book.", "#ffe9e6"),
                                  ("🔢", "Maths", "Counting games, patterns and puzzles that click.", "#fff4d1"),
                                  ("🔬", "Science", "Kitchen experiments and big questions about the world.", "#e4f7ec"),
                                  ("🎨", "Art", "Drawing, colour and making things with your hands.", "#efe7ff"))
        ]),
    ], name="Subjects")

    catalogue = section([
        heading_group("Courses", "Little courses, big smiles", align="center"),
        courses(limit=6, columns=3, card="shadow"),
    ], name="Courses", base={"backgroundColor": "#fff7e6"})

    parents = section([
        cols([
            img(art("kids-detail"), "A parent and child reading together, drawn in simple shapes"),
            box([
                heading_group("For parents", "Screen time you can feel good about"),
                el("list", {"marker": "check", "items": ["Lessons under 15 minutes, with a natural stopping point", "No ads, no chat with strangers, ever",
                                                          "A weekly progress note in your inbox", "Designed with primary school teachers"]}),
                el("testimonials", {"layout": "grid", "columns": 1, "cardStyle": "flat", "items": [
                    {"quote": "My daughter asks for 'one more science adventure' before bed. I never thought I'd say that.", "author": "Laura Méndez", "role": "Mum of two", "rating": 5}]}),
            ], base={"gap": 24}),
        ], ratio="equal", gap=56),
    ], name="For parents", anchor="parents")

    faq = section([
        heading_group("Questions", "Parents often ask", align="center"),
        el("faq", {"items": [
            {"question": "What age is it for?", "answer": "Lessons are designed for ages 6 to 12, with levels that grow with your child."},
            {"question": "Can siblings share an account?", "answer": "Yes. Each child gets their own profile and progress under one family account."},
            {"question": "Do you follow a curriculum?", "answer": "Our lessons follow national curriculum goals for primary school, with lots of room to explore."},
        ]}, {"base": {"maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}),
        box([
            h(f"Start a free week with {org}", 2, base={"fontSize": "2.2rem", "textAlign": "center"}, mobile={"fontSize": "1.8rem"}),
            row([btn("Create a family account", "/signup", icon="ArrowRight")], base={"justifyContent": "center"}),
        ], base={"gap": 18, "alignItems": "center", "paddingTop": 48, "paddingBottom": 48, "paddingLeft": 24, "paddingRight": 24, "borderRadius": 36, "backgroundColor": "#fff1c7"}),
    ], name="FAQ")
    return page(th, [hero, subjects, catalogue, parents, faq], title=f"{org} — playful learning for kids", description="Joyful lessons in reading, maths, science and art for ages 6 to 12.")


# ─── 10. Nonprofit ────────────────────────────────────────────────────────────


def nonprofit(ctx: dict) -> dict:
    org = _org(ctx, "Open Commons")
    th = theme(primary="#2f5d50", secondary="#1c3a32", accent="#d08c34", background="#f4efe6", surface="#ebe3d5", text="#22251f",
               muted="#5f6157", border="#ddd3c1", heading="Lora", body="Work Sans", radius="md", button="solid", weight="600")
    hero = section([
        box([
            eyebrow("Free learning for everyone", color="$accent"),
            h("Knowledge should belong to everyone who wants it.", 1, base={"fontSize": "4.4rem", "lineHeight": 1.08, "textAlign": "center", "maxWidth": "980px", "letterSpacing": "-0.02em"},
              tablet={"fontSize": "3.4rem"}, mobile={"fontSize": "2.4rem"}, animation=anim("fade")),
            t(f"{org} offers free courses in digital skills, financial literacy and civic life, built with community partners and funded by people like you.",
              base={"fontSize": "1.1875rem", "lineHeight": 1.7, "color": "$muted", "textAlign": "center", "maxWidth": "640px"}),
            row([btn("Start learning, free", "/courses", icon="ArrowRight"), btn("Support our work", "#support", "outline", base={"color": "$primary"})], gap=12, base={"justifyContent": "center"},
                mobile={"flexDirection": "column", "alignItems": "stretch"}),
        ], base={"gap": 24, "alignItems": "center"}),
        img(art("nonprofit-hero"), "Hands passing a lit lantern across a landscape", base={"borderRadius": 12, "aspectRatio": "21/9", "objectFit": "cover"}, mobile={"aspectRatio": "4/3"}, animation=anim("fade", 200, 1000)),
    ], name="Hero", pad=(96, 96))

    impact = section([
        cols([
            heading_group("Our impact", "Every course is free. Every year, more people finish one.", title_style={"color": "#f4efe6"}, eyebrow_color="#e9b56f"),
            el("container", {}, {"base": {"display": "grid", "gridColumns": 2, "gap": 36}, "mobile": {"gridColumns": 1}}, [
                stat(v, lbl, value_style={"color": "#f4efe6", "fontWeight": "500"}, label_style={"color": "#c9d3cd"})
                for v, lbl in (("214,000", "Learners since we began"), ("63", "Community partners"), ("0", "Paywalls, adverts or data sold"), ("71%", "Report a new job or promotion"))
            ]),
        ], ratio="equal", gap=72),
    ], name="Impact", base={"backgroundColor": "$primary", "color": "#f4efe6"})

    catalogue = section([
        heading_group("Free courses", "Start where you are", "Short, practical courses in plain language, available in several languages and designed to work on any phone."),
        courses(limit=6, columns=3, card="flat"),
    ], name="Courses")

    story = section([
        cols([
            box([
                heading_group("Why we exist", "Learning changed our lives. We want to pass it on."),
                el("richtext", {"markdown": "We started as a group of librarians and volunteers running evening classes in a community centre. Today our courses reach people in more than a hundred countries.\n\nWe believe that **access to good teaching should not depend on income, postcode or background.** Everything we make is free, and stays free."}),
            ], base={"gap": 24}),
            el("logos", {"grayscale": True, "size": "md", "items": [{"src": f"/landing-logo-{i}.svg", "alt": f"Partner {i}"} for i in range(1, 6)]}, {"base": {"justifyContent": "flex-start"}}),
        ], ratio="3:2", gap=64),
    ], name="Mission", base={"backgroundColor": "$surface"})

    support = section([
        box([
            h("Keep learning free.", 2, base={"fontSize": "3rem", "textAlign": "center"}, mobile={"fontSize": "2.1rem"}),
            t("A monthly gift of any size funds a learner's course materials for a year. Or join the newsletter to hear what your support makes possible.",
              base={"textAlign": "center", "color": "$muted", "maxWidth": "600px", "fontSize": 17}),
            row([btn("Become a supporter", "/store", icon="HandHeart")], base={"justifyContent": "center"}),
            el("newsletter", {"placeholder": "Your email", "buttonLabel": "Get the newsletter", "successText": "Thank you. Our next letter is on its way.", "layout": "inline"},
               {"base": {"maxWidth": "480px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}),
        ], base={"gap": 20, "alignItems": "center"}),
    ], name="Support", anchor="support")
    return page(th, [hero, impact, catalogue, story, support], title=f"{org} — free courses", description="Free courses in digital skills, money and civic life.")


# ─── 11. Cohort course ────────────────────────────────────────────────────────


def cohort(ctx: dict) -> dict:
    th = theme(primary="#ff5b1f", secondary="#0a0a0a", accent="#ff5b1f", background="#ffffff", surface="#f4f4f2", text="#0a0a0a",
               muted="#5a5a57", border="#e6e6e3", heading="Instrument Serif", body="Inter", radius="sm", button="solid", weight="500")
    hero = section([
        box([
            row([t("Cohort 7", base={"fontSize": 13, "fontWeight": "600", "color": "#ffffff", "backgroundColor": "$primary", "paddingTop": 4, "paddingBottom": 4, "paddingLeft": 10, "paddingRight": 10, "borderRadius": 4}),
                 t("Six weeks · Live · 40 seats", base={"fontSize": 14, "color": "$muted"})], gap=12),
            h("Become the product manager your team trusts.", 1, base={"fontSize": "6rem", "lineHeight": 0.95, "letterSpacing": "-0.035em", "fontWeight": "400", "maxWidth": "1000px"},
              tablet={"fontSize": "4.4rem"}, mobile={"fontSize": "3rem"}, animation=anim("slide-up")),
            cols([
                t("A live, six-week course for new and aspiring product managers. Weekly workshops, a real case to work on, and a cohort of peers you'll keep for years.",
                  base={"fontSize": "1.25rem", "lineHeight": 1.6, "color": "$muted"}),
                box([row([btn("Reserve your seat", "#enrol", icon="ArrowRight"), btn("See the syllabus", "#syllabus", "ghost")], gap=8),
                     t("Next cohort begins on the first Monday of next month.", base={"fontSize": 13, "color": "$muted"})], base={"gap": 10, "alignItems": "flex-end"},
                    mobile={"alignItems": "flex-start"}),
            ], ratio="equal", gap=48, base={"alignItems": "flex-end"}),
        ], base={"gap": 32}),
    ], name="Hero", pad=(112, 72))

    banner = section([img(art("cohort-hero"), "Sticky notes arranged into a product roadmap on a wall", base={"aspectRatio": "21/9", "objectFit": "cover"}, mobile={"aspectRatio": "4/3"})],
                     name="Banner", pad=(0, 96), mpad=(0, 64), width="100%", base={"paddingLeft": 0, "paddingRight": 0}, mobile={"paddingLeft": 0, "paddingRight": 0})

    syllabus = section([
        cols([
            box([heading_group("Syllabus", "Six weeks, six skills", title_style={"fontWeight": "400", "fontSize": "3.5rem"}),
                 t("Each week: a 90-minute live workshop, a short reading, and a piece of your case study reviewed by an instructor.", base={"color": "$muted", "fontSize": 16, "lineHeight": 1.7})],
                base={"gap": 20}),
            el("steps", {"layout": "vertical", "items": [
                {"title": "Discovery that changes minds", "text": "Interviews, synthesis and the art of the uncomfortable question."},
                {"title": "Strategy on one page", "text": "Bets, trade-offs and a narrative your leadership can repeat."},
                {"title": "Prioritising in public", "text": "Roadmaps that survive contact with sales and engineering."},
                {"title": "Shipping with engineers", "text": "Specs, scope and the rituals that actually help."},
                {"title": "Metrics that matter", "text": "Choosing, instrumenting and reviewing the numbers."},
                {"title": "Leading without authority", "text": "Influence, alignment and saying no kindly."},
            ]}),
        ], ratio="2:3", gap=72, base={"alignItems": "flex-start"}),
    ], name="Syllabus", anchor="syllabus")

    teachers = section([
        heading_group("Instructors", "Taught by people who've done the job", align="center", title_style={"fontWeight": "400"}),
        el("instructors", {"layout": "row", "people": [
            {"name": "Elena Sorensen", "role": "Former VP Product, fintech"},
            {"name": "Kwame Asante", "role": "Group PM, developer tools"},
            {"name": "Ruth Halevi", "role": "Product coach, ex-marketplace"},
        ]}),
        el("testimonials", {"layout": "single", "items": [{"quote": "The most useful six weeks of my career. I walked into my next planning cycle with a completely different level of confidence.",
                                                           "author": "Daniela Costa", "role": "Product manager, Cohort 5"}]}),
    ], name="Instructors", base={"backgroundColor": "$surface"})

    course = section([
        heading_group("The course", "Everything inside, at your pace between sessions", title_style={"fontWeight": "400", "fontSize": "3.5rem"}),
        el("course", {"layout": "split", "buttonLabel": "See the course", "showDescription": True}),
    ], name="Course")

    enrol = section([
        cols([
            box([
                heading_group("Enrol", "Doors close in", title_style={"fontWeight": "400", "fontSize": "3.5rem"}),
                el("countdown", {"doneText": "Enrolment is closed. Join the waitlist for the next cohort."}, {"base": {"justifyContent": "flex-start"}}),
            ], base={"gap": 28}),
            el("pricing", {"columns": 1, "plans": [
                {"name": "Cohort 7", "price": "$1,450", "period": "per seat", "description": "Most learners expense it through their learning budget.",
                 "features": ["6 live workshops", "Case study with written reviews", "Lifetime access to recordings", "Alumni community"], "highlighted": True, "button": {"label": "Reserve your seat", "href": "/signup"}},
            ]}),
        ], ratio="equal", gap=64, base={"alignItems": "flex-start"}),
        el("faq", {"layout": "two-columns", "items": [
            {"question": "How much time does it take?", "answer": "About four hours a week: the live workshop plus reading and your case study."},
            {"question": "What if I miss a session?", "answer": "Every workshop is recorded, and instructors hold a weekly catch-up hour."},
            {"question": "Is there a team rate?", "answer": "Yes, three or more seats from the same company get 15% off."},
            {"question": "Can I get a refund?", "answer": "Full refund until the end of the first week, no questions asked."},
        ]}),
    ], name="Enrol", anchor="enrol")
    return page(th, [hero, banner, syllabus, teachers, course, enrol], title="Live product management cohort", description="A six-week live course for new and aspiring product managers.")


# ─── 12. Membership community ─────────────────────────────────────────────────


def membership(ctx: dict) -> dict:
    org = _org(ctx, "the Circle")
    th = theme(primary="#ff7ab6", secondary="#2a1846", accent="#8b7bff", background="#120a20", surface="#1d1330", text="#f4eefc",
               muted="#a99bc0", border="#2f2347", heading="Sora", body="Manrope", radius="xl", button="pill", width="wide", weight="700")
    hero = section([
        box([
            h("Find your people. Make better things together.", 1, base={"fontSize": "5.2rem", "lineHeight": 1.0, "letterSpacing": "-0.045em", "textAlign": "center", "maxWidth": "1040px"},
              tablet={"fontSize": "4rem"}, mobile={"fontSize": "2.7rem"}, animation=anim("slide-up")),
            t(f"{org} is a membership for makers: monthly workshops, a library of courses, critique circles and a community that shows up for each other.",
              base={"fontSize": "1.25rem", "lineHeight": 1.6, "color": "$muted", "textAlign": "center", "maxWidth": "640px"}, mobile={"fontSize": "1.0625rem"}),
            row([btn("Become a member", "#join", icon="ArrowRight"), btn("Look around first", "#inside", "outline", base={"color": "$text"})], gap=12, base={"justifyContent": "center"},
                mobile={"flexDirection": "column", "alignItems": "stretch"}),
            img(art("membership-hero"), "Glowing avatars connected in a constellation", base={"maxWidth": "980px", "marginTop": 24}, animation=anim("fade", 250, 1000)),
        ], base={"gap": 24, "alignItems": "center"}),
    ], name="Hero", base={"backgroundGradient": {"from": "#3a1d5c", "to": "#120a20", "type": "radial"}}, pad=(112, 72))

    inside = section([
        heading_group("Inside the membership", "Everything you get, every month", align="center", eyebrow_color="$primary"),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 3, "gap": 16}, "tablet": {"gridColumns": 1}}, [
            feature(i, ti, tx, card={"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 28, "paddingRight": 28, "backgroundColor": "$surface", "borderRadius": 24, "borderWidth": 1, "borderColor": "$border"},
                    tile={"backgroundColor": "#2b1d44"}, icon_color="$primary")
            for i, ti, tx in (("VideoCamera", "Live workshops", "Two hands-on sessions a month with working artists and designers."),
                              ("Books", "The full course library", "Every course we've ever made, with new ones each season."),
                              ("ChatsCircle", "Critique circles", "Small groups that meet weekly to share work and push each other."))
        ]),
    ], name="Inside", anchor="inside")

    community = section([
        heading_group("Community spaces", "Where members hang out"),
        el("communities", {"limit": 3, "columns": 3, "cardStyle": "border", "emptyText": "Community spaces open to members."}),
        heading_group("Coming up", "Next live sessions"),
        el("live_sessions", {"limit": 3, "layout": "grid", "emptyText": "The next workshop will be announced soon."}),
    ], name="Community")

    listen = section([
        cols([
            heading_group("The podcast", "Conversations with members", "Studio visits, process talks and honest stories about making a living from creative work."),
            el("podcasts", {"limit": 2, "columns": 2, "cardStyle": "border", "emptyText": "The first episode is in the edit."}),
        ], ratio="2:3", gap=56, base={"alignItems": "flex-start"}),
    ], name="Podcast", base={"backgroundColor": "$surface"})

    join = section([
        heading_group("Membership", "Join the Circle", align="center"),
        el("pricing", {"columns": 2, "plans": [
            {"name": "Monthly", "price": "$24", "period": "/ month", "description": "Everything, month to month.", "features": ["All workshops", "Course library", "Critique circles"], "button": {"label": "Join monthly", "href": "/signup"}},
            {"name": "Yearly", "price": "$220", "period": "/ year", "description": "Two months free, plus a welcome call.", "features": ["Everything in monthly", "1:1 welcome call", "Member-only events"], "highlighted": True, "badge": "Save 24%", "button": {"label": "Join yearly", "href": "/signup"}},
        ]}),
        el("testimonials", {"layout": "carousel", "cardStyle": "border", "items": [
            {"quote": "I finished more work in my first three months here than in the previous year.", "author": "Noor Haddad", "role": "Illustrator"},
            {"quote": "The critique circle is the best part of my week.", "author": "Felix Andersson", "role": "Type designer"},
            {"quote": "Generous, talented people. I've found collaborators and friends.", "author": "Sofía Vargas", "role": "Motion designer"},
        ]}),
    ], name="Join", anchor="join")
    return page(th, [hero, inside, community, listen, join], title=f"{org} — a membership for makers", description="Workshops, courses and critique circles for creative people.")


# ─── 13. B2B partner academy ──────────────────────────────────────────────────


def partner(ctx: dict) -> dict:
    org = _org(ctx, "Partner")
    th = theme(primary="#4f46e5", secondary="#0b1220", accent="#22d3ee", background="#ffffff", surface="#f5f6fb", text="#0b1220",
               muted="#58607a", border="#e4e6f0", heading="Manrope", body="Inter", radius="lg", button="solid", width="wide", weight="800")
    hero = section([
        cols([
            box([
                eyebrow("Partner Academy", color="#7dd3fc"),
                h("Sell it, build it, support it. Certified.", 1, base={"fontSize": "4.4rem", "lineHeight": 1.02, "letterSpacing": "-0.04em", "color": "#ffffff"}, tablet={"fontSize": "3.4rem"}, mobile={"fontSize": "2.5rem"}, animation=anim("slide-up")),
                t(f"Role-based learning for resellers, integrators and support teams. Earn {org} certifications, unlock partner tiers, and win more deals.",
                  base={"fontSize": "1.125rem", "lineHeight": 1.7, "color": "#aab3cc", "maxWidth": "520px"}),
                row([btn("Start your learning path", "#paths", icon="ArrowRight"), btn("Partner sign in", "/login", "outline", base={"color": "#ffffff"})], gap=12, mobile={"flexDirection": "column", "alignItems": "stretch"}),
            ], base={"gap": 24}),
            img(art("partner-hero"), "Certification badges stacked by tier", animation=anim("slide-in", 150, 900)),
        ], ratio="equal", gap=56),
    ], name="Hero", base={"backgroundColor": "$secondary", "color": "#ffffff", "backgroundGradient": {"from": "#1d2559", "to": "#0b1220", "type": "radial"}}, pad=(96, 96))

    roles = section([
        heading_group("Learning paths", "One path per role", "Pick the path that matches your job. Each ends with a proctored certification exam.", align="center"),
        el("paths", {"source": "latest", "limit": 3, "columns": 3, "cardStyle": "shadow"}),
    ], name="Paths", anchor="paths")

    tiers = section([
        heading_group("Partner tiers", "Certifications unlock benefits", align="center"),
        el("pricing", {"columns": 3, "plans": [
            {"name": "Registered", "price": "1", "period": "certified person", "description": "Get listed and access deal registration.", "features": ["Partner portal", "Sales playbooks", "Demo environment"], "button": {"label": "Get started", "href": "/signup"}},
            {"name": "Silver", "price": "3", "period": "certified people", "description": "Higher margins and co-marketing funds.", "features": ["Everything in Registered", "Co-marketing budget", "Priority support"], "highlighted": True, "badge": "Most partners", "button": {"label": "See requirements", "href": "/courses"}},
            {"name": "Gold", "price": "8", "period": "certified people", "description": "Our closest partners, featured to customers.", "features": ["Everything in Silver", "Partner directory feature", "Dedicated partner manager"], "button": {"label": "Talk to us", "href": "#contact"}},
        ]}),
    ], name="Tiers", base={"backgroundColor": "$surface"})

    catalogue = section([
        row([heading_group("Courses", "Product training, always current"), btn("All courses", "/courses", "outline", size="md")], base={"justifyContent": "space-between", "alignItems": "flex-end"}),
        courses(limit=6, columns=3, card="border"),
        el("logos", {"grayscale": True, "size": "sm", "items": [{"src": f"/landing-logo-{i}.svg", "alt": f"Partner {i}"} for i in range(1, 6)]}),
    ], name="Courses")

    contact = section([
        cols([
            heading_group("Become a partner", "Not a partner yet?", "Tell us about your company. Our channel team replies within two working days."),
            el("form", {"submitLabel": "Apply to the programme", "successText": "Thanks. Our channel team will reach out shortly.", "fields": [
                {"key": "name", "label": "Name", "type": "text", "required": True},
                {"key": "email", "label": "Work email", "type": "email", "required": True},
                {"key": "company", "label": "Company", "type": "text", "required": True},
                {"key": "type", "label": "Partner type", "type": "select", "options": ["Reseller", "Integrator", "Agency", "Technology partner"]},
            ]}),
        ], ratio="equal", gap=64, base={"alignItems": "flex-start"}),
    ], name="Contact", anchor="contact")
    return page(th, [hero, roles, tiers, catalogue, contact], title=f"{org} Partner Academy", description="Role-based training and certifications for partners.")


# ─── 14. Art & design school ──────────────────────────────────────────────────


def atelier(ctx: dict) -> dict:
    org = _org(ctx, "Atelier")
    th = theme(primary="#e2401c", secondary="#111111", accent="#2f54eb", background="#f2efe9", surface="#e8e3d9", text="#111111",
               muted="#5b5750", border="#d3ccbf", heading="Syne", body="Archivo", radius="none", button="solid", width="wide", weight="800")
    hero = section([
        h("Make\nthe work\nonly you\ncan make.", 1, base={"fontSize": "8.5rem", "lineHeight": 0.86, "letterSpacing": "-0.05em", "textTransform": "uppercase"},
          tablet={"fontSize": "6rem"}, mobile={"fontSize": "3.4rem"}, animation=anim("slide-up", 0, 900)),
        cols([
            t(f"{org} is a school of art and design for people who want a practice, not just a portfolio. Drawing, type, image-making and the long habit of looking.",
              base={"fontSize": "1.25rem", "lineHeight": 1.55, "maxWidth": "520px"}),
            box([row([btn("View the courses", "/courses", icon="ArrowRight", base={"borderRadius": 0}), btn("Open studios", "#work", "outline", base={"borderRadius": 0})], gap=10)],
                base={"alignItems": "flex-end"}, mobile={"alignItems": "flex-start"}),
        ], ratio="equal", gap=40, base={"alignItems": "flex-end"}),
    ], name="Hero", pad=(96, 64), inner={"gap": 48})

    work = section([
        row([eyebrow("Student work · This term", color="$text"), t("(01–04)", base={"fontSize": 12, "letterSpacing": "0.1em", "color": "$muted"})], base={"justifyContent": "space-between"}),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 12}, "tablet": {"gridColumns": 2}}, [
            box([img(art(f"atelier-{i}"), alt, base={"aspectRatio": "3/4", "objectFit": "cover"}), row([t(cap, base={"fontSize": 13, "fontWeight": "600"}), t(who, base={"fontSize": 13, "color": "$muted"})], base={"justifyContent": "space-between"})],
                base={"gap": 10})
            for i, alt, cap, who in ((1, "A bold red and blue geometric print", "Riso print", "M. Ortega"), (2, "An expressive charcoal figure study", "Figure study", "A. Nwosu"),
                                     (3, "A typographic poster of overlapping letters", "Type poster", "L. Brandt"), (4, "A collage of torn paper shapes", "Collage", "S. Ito"))
        ]),
    ], name="Student work", anchor="work", pad=(32, 96))

    disciplines = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 2, "gap": 0}, "mobile": {"gridColumns": 1}}, [
            box([
                row([t(n, base={"fontSize": 13, "color": "$primary", "fontWeight": "700", "minWidth": "24px"}), h(ti, 3, base={"fontSize": "2.25rem", "textTransform": "uppercase", "letterSpacing": "-0.02em"}, tablet={"fontSize": "1.75rem"}, mobile={"fontSize": "1.25rem"})], gap=16, wrap=False, base={"alignItems": "baseline"}, mobile={"gap": 10}),
                t(tx, base={"color": "$muted", "fontSize": 15, "lineHeight": 1.6, "maxWidth": "420px"}),
            ], base={"gap": 12, "paddingTop": 32, "paddingBottom": 32, "paddingRight": 32, "borderColor": "$text", "borderStyle": "solid", "borderWidth": 0}, hover={"color": "$primary"})
            for n, ti, tx in (("01", "Drawing", "Observation, gesture and line. The foundation everything else rests on."),
                              ("02", "Typography", "Letterforms, hierarchy and the voice of a page."),
                              ("03", "Image-making", "Printmaking, collage and digital illustration."),
                              ("04", "Practice", "Critique, research and building a body of work over time."))
        ]),
    ], name="Disciplines", base={"backgroundColor": "$surface"})

    catalogue = section([
        h("Courses", 2, base={"fontSize": "5rem", "textTransform": "uppercase", "letterSpacing": "-0.04em", "lineHeight": 0.9}, mobile={"fontSize": "2.4rem"}),
        courses(limit=6, columns=3, card="minimal"),
    ], name="Courses")

    teachers = section([
        cols([
            h("Taught by working artists.", 2, base={"fontSize": "3.5rem", "lineHeight": 0.95, "textTransform": "uppercase", "letterSpacing": "-0.03em"}, mobile={"fontSize": "1.9rem"}),
            el("instructors", {"layout": "cards", "columns": 2, "people": [
                {"name": "Marta Ortega", "role": "Printmaker", "bio": "Shows in Madrid and Lisbon; teaches Riso and relief printing."},
                {"name": "Ade Nwosu", "role": "Illustrator", "bio": "Draws for newspapers and picture books; leads figure drawing."},
            ]}),
        ], ratio="equal", gap=56, base={"alignItems": "flex-start"}),
    ], name="Teachers", base={"backgroundColor": "$secondary", "color": "#f2efe9"})

    cta = section([
        row([
            h("Spring term — enrol now", 2, base={"fontSize": "3rem", "textTransform": "uppercase", "letterSpacing": "-0.03em"}, mobile={"fontSize": "1.6rem"}),
            btn("Apply", "/signup", "secondary", icon="ArrowUpRight", base={"borderRadius": 0}),
        ], base={"justifyContent": "space-between"}, gap=24),
    ], name="Call to action", base={"backgroundColor": "$primary", "color": "#111111"}, pad=(72, 72))
    return page(th, [hero, work, disciplines, catalogue, teachers, cta], title=f"{org} — school of art and design", description="Courses in drawing, typography and image-making.")


# ─── 15. Certification body ───────────────────────────────────────────────────


def certification(ctx: dict) -> dict:
    org = _org(ctx, "the Institute")
    th = theme(primary="#142850", secondary="#0b1a36", accent="#b8913a", background="#ffffff", surface="#f5f3ee", text="#111a2c",
               muted="#56607a", border="#e5e1d8", heading="EB Garamond", body="Libre Franklin", radius="sm", button="solid", weight="600")
    hero = section([
        cols([
            box([
                eyebrow("Professional certification", color="#d9b86c"),
                h("The credential employers look for.", 1, base={"fontSize": "4.6rem", "lineHeight": 1.02, "letterSpacing": "-0.02em", "color": "#ffffff"}, tablet={"fontSize": "3.6rem"}, mobile={"fontSize": "2.7rem"}, animation=anim("fade")),
                t(f"{org} sets the standard for professional practice. Prepare with official courses, sit a proctored exam, and hold a credential anyone can verify.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.7, "color": "#c3cbe0", "maxWidth": "540px"}),
                row([btn("Explore the certifications", "#levels", "secondary", icon="ArrowRight"), btn("Verify a certificate", "/certificates", "outline", base={"color": "#ffffff"})], gap=12,
                    mobile={"flexDirection": "column", "alignItems": "stretch"}),
            ], base={"gap": 24}),
            img(art("certification-seal"), "A gold embossed certification seal", base={"maxWidth": "420px", "marginLeft": "auto", "marginRight": "auto"}, animation=anim("zoom", 200, 1000)),
        ], ratio="3:2", gap=56),
    ], name="Hero", base={"backgroundColor": "$primary", "color": "#ffffff"}, pad=(104, 104))

    standing = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 24}, "tablet": {"gridColumns": 2}, "mobile": {"gridColumns": 1}}, [
            stat(v, lbl, value_style={"fontWeight": "500", "color": "$primary"}) for v, lbl in (("48,000", "Credential holders"), ("120", "Countries"), ("1987", "Setting the standard since"), ("ISO 17024", "Accredited scheme"))
        ]),
    ], name="Standing", pad=(64, 64), base={"backgroundColor": "$surface"})

    levels = section([
        heading_group("Certification levels", "A path from practitioner to fellow", "Each level builds on the last. Requirements combine study, experience and an examination.", align="center"),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 3, "gap": 0, "borderWidth": 1, "borderColor": "$border"}, "tablet": {"gridColumns": 1}}, [
            box([
                t(lvl, base={"fontFamily": "heading", "fontSize": "1rem", "letterSpacing": "0.18em", "textTransform": "uppercase", "color": "$accent"}),
                h(ti, 3, base={"fontSize": "2rem", "fontWeight": "500"}),
                t(tx, base={"color": "$muted", "fontSize": 15, "lineHeight": 1.65}),
                divider(),
                el("list", {"marker": "dot", "items": reqs}, {"base": {"fontSize": 14}}),
            ], base={"gap": 14, "paddingTop": 36, "paddingBottom": 36, "paddingLeft": 32, "paddingRight": 32, "backgroundColor": bg})
            for lvl, ti, tx, reqs, bg in (
                ("Level I", "Associate", "For people starting out. Demonstrates command of the core body of knowledge.", ["Official preparation course", "90-minute exam", "No experience required"], "#ffffff"),
                ("Level II", "Professional", "For practitioners. Shows you can apply the standard in real situations.", ["Associate credential", "Two years of experience", "Case-based exam"], "#faf8f3"),
                ("Level III", "Fellow", "For leaders of the field. Peer-reviewed portfolio and interview.", ["Professional credential", "Seven years of experience", "Portfolio and panel"], "#f5f1e8"),
            )
        ]),
    ], name="Levels", anchor="levels")

    prep = section([
        row([heading_group("Exam preparation", "Official preparation courses", "Written by the examiners, aligned with the current body of knowledge."),
             btn("All courses", "/courses", "outline", size="md")], base={"justifyContent": "space-between", "alignItems": "flex-end"}),
        courses(limit=3, columns=3, card="border"),
    ], name="Preparation", base={"backgroundColor": "$surface"})

    process = section([
        cols([
            box([heading_group("Getting certified", "How the process works"),
                 img(art("certification-hero"), "A digital certificate with a verification code", base={"boxShadow": "lg"})], base={"gap": 28}),
            el("steps", {"layout": "vertical", "items": [
                {"title": "Create your candidate profile", "text": "Record your education and experience in one place."},
                {"title": "Prepare with official materials", "text": "Courses, practice exams and study groups."},
                {"title": "Book a proctored exam", "text": "Online or at a test centre, in nine languages."},
                {"title": "Receive your verifiable credential", "text": "A digital certificate with a public verification link."},
            ]}),
        ], ratio="equal", gap=72, base={"alignItems": "flex-start"}),
    ], name="Process")

    faq = section([
        heading_group("Candidates ask", "Frequently asked questions", align="center"),
        el("faq", {"items": [
            {"question": "How long is a credential valid?", "answer": "Three years. Renew by logging continuing education hours in your profile."},
            {"question": "Can employers verify my credential?", "answer": "Yes. Every certificate carries a code that anyone can check on our verification page."},
            {"question": "What if I fail the exam?", "answer": "You can resit after 30 days. Your score report shows where to focus."},
        ]}, {"base": {"maxWidth": "780px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}),
    ], name="FAQ", base={"backgroundColor": "$surface"})
    return page(th, [hero, standing, levels, prep, process, faq], title=f"{org} — professional certification", description="Official preparation, proctored exams and verifiable credentials.")
