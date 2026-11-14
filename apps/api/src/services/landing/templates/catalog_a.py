"""Templates 1-8: academy, bootcamp, corporate training, university
department, creator/coach, language school, health CE and coding school."""

from __future__ import annotations

from src.services.landing.recipes import el
from src.services.landing.templates.kit import (
    anim, art, box, btn, cols, courses, divider, eyebrow, feature, h, heading_group, icon, img, page, row, section, stat, t, theme,
)


def _org(ctx: dict, fallback: str) -> str:
    return (ctx.get("org_name") or "").strip() or fallback


# ─── 1. Academy ───────────────────────────────────────────────────────────────


def academy(ctx: dict) -> dict:
    org = _org(ctx, "the Academy")
    th = theme(primary="#1f4d3a", secondary="#14281f", accent="#c08a3e", background="#f7f4ee", surface="#efe9de", text="#1c1b18",
               muted="#5f5a50", border="#ddd5c6", heading="Fraunces", body="Inter", radius="sm", button="solid", weight="500")
    hero = section([
        cols([
            box([
                eyebrow("Online academy · Est. for working learners", color="$accent"),
                h("Learn the craft from people who practise it.", 1, base={"fontSize": "4.75rem", "lineHeight": 1.02, "letterSpacing": "-0.035em", "fontWeight": "400"},
                  tablet={"fontSize": "3.75rem"}, mobile={"fontSize": "2.75rem"}, animation=anim("slide-up")),
                t(f"{org} brings small, carefully made courses to people who learn alongside a job, a family and a life. Watch, practise, get feedback, and finish.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.7, "color": "$muted", "maxWidth": "520px"}, mobile={"fontSize": "1.0625rem"}, animation=anim("slide-up", 120)),
                row([btn("Explore the catalogue", "/courses", icon="ArrowRight"), btn("How it works", "#method", "ghost", base={"color": "$primary"})], gap=12,
                    mobile={"flexDirection": "column", "alignItems": "stretch"}),
                row([
                    t("★★★★★", base={"color": "$accent", "letterSpacing": "0.12em", "fontSize": 14}),
                    t("Rated 4.9 by more than 2,000 graduates", base={"fontSize": 14, "color": "$muted"}),
                ], gap=12, base={"paddingTop": 8}),
            ], base={"gap": 28}),
            box([img(art("academy-hero"), "An arched window opening onto a quiet garden", base={"borderRadius": 4}, animation=anim("fade", 150, 900))]),
        ], ratio="3:2", gap=72),
    ], name="Hero", pad=(96, 112), mpad=(48, 72))

    numbers = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 0, "borderColor": "$border", "borderStyle": "solid", "borderWidth": 1}, "tablet": {"gridColumns": 2}, "mobile": {"gridColumns": 1}}, [
            box([stat(v, lbl, value_style={"fontWeight": "400"})], base={"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 28, "paddingRight": 28, "borderColor": "$border", "borderStyle": "solid", "borderWidth": 0})
            for v, lbl in (("38", "Courses, each under six hours"), ("12k", "Learners in 64 countries"), ("94%", "Finish what they start"), ("1:1", "Feedback on every project"))
        ]),
    ], name="In numbers", pad=(0, 96), mpad=(0, 64))

    catalogue = section([
        row([
            heading_group("The catalogue", "Courses worth finishing", "Each course is a short arc: a handful of lessons, one real project and a reviewer who reads your work.",
                          title_style={"fontWeight": "400"}),
            btn("All courses", "/courses", "outline", size="md", icon="ArrowRight"),
        ], base={"justifyContent": "space-between", "alignItems": "flex-end"}, gap=24),
        courses(limit=6, columns=3, card="minimal"),
    ], name="Courses", anchor="courses", base={"backgroundColor": "$background"})

    method = section([
        cols([
            box([
                heading_group("The method", "Small lessons. Real work. Honest feedback.", title_style={"fontWeight": "400"}),
                t("We cut every course down to what you will actually use, then build it around a project you can show. Mentors review each submission within two working days.",
                  base={"fontSize": 17, "lineHeight": 1.75, "color": "$muted", "maxWidth": "480px"}),
            ], base={"gap": 24}),
            box([
                box([
                    row([t(n, base={"fontFamily": "heading", "fontSize": "2rem", "color": "$accent", "minWidth": "56px"}),
                         box([h(ti, 3, base={"fontSize": "1.25rem", "fontWeight": "500"}), t(tx, base={"color": "$muted", "fontSize": 15, "lineHeight": 1.6})], base={"gap": 6, "flexGrow": 1})],
                        gap=20, wrap=False, base={"alignItems": "flex-start"}),
                    divider(),
                ], base={"gap": 24})
                for n, ti, tx in (
                    ("01", "Watch a short lesson", "Ten to fifteen minutes, filmed in a real studio, with notes you can keep."),
                    ("02", "Practise on your own project", "Every module ends with a task that moves your project forward."),
                    ("03", "Get a mentor's review", "Written feedback, line by line, from someone who does this for a living."),
                )
            ], base={"gap": 24}),
        ], ratio="equal", gap=96, base={"alignItems": "flex-start"}),
    ], name="Method", anchor="method", base={"backgroundColor": "$surface"})

    paths = section([
        heading_group("Learning paths", "Follow a path, earn a certificate", "Paths string courses together in the right order, so you always know what comes next.",
                      align="center", title_style={"fontWeight": "400"}),
        el("paths", {"source": "latest", "limit": 3, "columns": 3, "cardStyle": "border"}),
    ], name="Paths")

    quote = section([
        el("testimonials", {"layout": "single", "items": [{"quote": "It is the first online course I actually finished. The feedback felt like having a patient senior colleague at my side.",
                                                           "author": "Hélène Marchetti", "role": "Graduate, Garden Design", "rating": 5}]},
           {"base": {"color": "#f7f4ee"}}),
    ], name="Testimonial", base={"backgroundColor": "$primary", "color": "#f7f4ee"}, pad=(120, 120))

    cta = section([
        box([
            h("Start with one course. See where it takes you.", 2, base={"fontSize": "3.25rem", "fontWeight": "400", "textAlign": "center", "letterSpacing": "-0.03em", "lineHeight": 1.1}, mobile={"fontSize": "2.1rem"}),
            t("Free to join. Pay only for the courses you take.", base={"textAlign": "center", "color": "$muted", "fontSize": 17}),
            row([btn("Create a free account", "/signup", icon="ArrowRight"), btn("Browse courses", "/courses", "outline")], gap=12, base={"justifyContent": "center"},
                mobile={"flexDirection": "column", "alignItems": "stretch"}),
        ], base={"gap": 20, "alignItems": "center", "maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto"}, animation=anim("fade")),
    ], name="Call to action", pad=(128, 128))
    return page(th, [hero, numbers, catalogue, method, paths, quote, cta], title=f"{org} — online courses", description="Short, carefully made courses with real projects and mentor feedback.")


# ─── 2. Bootcamp ──────────────────────────────────────────────────────────────


def bootcamp(ctx: dict) -> dict:
    th = theme(primary="#c6f432", secondary="#1a1f26", accent="#7c5cff", background="#0b0d10", surface="#14181e", text="#e9edf2",
               muted="#8b95a3", border="#232a33", heading="Space Grotesk", body="Inter", radius="md", button="solid", width="wide", weight="700")
    mono = "JetBrains Mono"
    hero = section([
        box([
            row([box([t("●", base={"color": "$primary", "fontSize": 10})]), t("Next cohort starts soon · 24 seats", base={"fontFamily": mono, "fontSize": 13, "color": "$muted"})],
                gap=10, base={"paddingTop": 8, "paddingBottom": 8, "paddingLeft": 14, "paddingRight": 14, "borderWidth": 1, "borderColor": "$border", "borderRadius": 999, "backgroundColor": "$surface"}),
            h("Twelve weeks.\nOne new career.", 1, base={"fontSize": "6rem", "lineHeight": 0.98, "letterSpacing": "-0.045em", "textAlign": "center"},
              tablet={"fontSize": "4.5rem"}, mobile={"fontSize": "3rem"}, animation=anim("slide-up")),
            t("A full-time, project-first bootcamp. You ship real software every week, pair with working engineers, and graduate with a portfolio employers can click through.",
              base={"fontSize": "1.25rem", "lineHeight": 1.6, "color": "$muted", "textAlign": "center", "maxWidth": "680px"}, mobile={"fontSize": "1.0625rem"}, animation=anim("slide-up", 120)),
            row([btn("Apply for the cohort", "#apply", icon="ArrowRight"), btn("Download the syllabus", "#syllabus", "secondary",
                 base={"backgroundColor": "$surface", "color": "$text", "borderColor": "$border"})], gap=12, base={"justifyContent": "center"},
                mobile={"flexDirection": "column", "alignItems": "stretch"}),
        ], base={"gap": 28, "alignItems": "center"}),
        img(art("bootcamp-hero"), "A code editor and a terminal running tests", base={"borderRadius": 16, "borderWidth": 1, "borderColor": "$border", "boxShadow": "xl"}, animation=anim("zoom", 200, 900)),
    ], name="Hero", base={"backgroundGradient": {"from": "#1b2a12", "to": "#0b0d10", "type": "radial"}}, pad=(104, 96), mpad=(56, 64))

    outcomes = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 16}, "tablet": {"gridColumns": 2}, "mobile": {"gridColumns": 1}}, [
            box([t(v, base={"fontFamily": "heading", "fontSize": "3.25rem", "fontWeight": "700", "letterSpacing": "-0.04em", "color": "$primary", "lineHeight": 1}),
                 t(lbl, base={"color": "$muted", "fontSize": 14, "lineHeight": 1.5})],
                base={"gap": 12, "paddingTop": 28, "paddingBottom": 28, "paddingLeft": 24, "paddingRight": 24, "backgroundColor": "$surface", "borderRadius": 14, "borderWidth": 1, "borderColor": "$border"})
            for v, lbl in (("87%", "Hired within six months of graduating"), ("480h", "Of hands-on building, not watching"), ("1:6", "Mentor to student ratio"), ("40+", "Hiring partners in our network"))
        ]),
    ], name="Outcomes", pad=(24, 96))

    syllabus = section([
        heading_group("// syllabus", "Built week by week", "Every phase ends with a shipped project, reviewed in a code review like the one you'll have on the job.",
                      eyebrow_font=mono, eyebrow_color="$primary"),
        el("steps", {"layout": "horizontal", "items": [
            {"title": "Weeks 1–3 · Foundations", "text": "Git, the command line, JavaScript and the web platform. You deploy on day four."},
            {"title": "Weeks 4–7 · Product", "text": "React, APIs and databases. Build a full app with real users in a team of three."},
            {"title": "Weeks 8–10 · Depth", "text": "Testing, performance and system design. Pick a specialism and go deep."},
            {"title": "Weeks 11–12 · Launch", "text": "Capstone, portfolio review, mock interviews and introductions to partners."},
        ]}),
    ], name="Syllabus", anchor="syllabus", base={"backgroundColor": "$surface"})

    tracks = section([
        heading_group("// tracks", "Start with a free prep course", "Not sure you're ready? The prep courses cover what the first week assumes.", eyebrow_font=mono),
        courses(limit=3, columns=3, card="border"),
    ], name="Prep courses")

    voices = section([
        heading_group("// graduates", "From the last cohort", eyebrow_font=mono, align="center"),
        el("testimonials", {"layout": "grid", "columns": 3, "cardStyle": "border", "items": [
            {"quote": "I was a chef for nine years. Twelve weeks later I had three offers. The pace is real, and so is the support.", "author": "Marcus Oyelaran", "role": "Frontend engineer"},
            {"quote": "The code reviews changed how I think. I still hear my mentor's voice when I name a variable.", "author": "Ines Albuquerque", "role": "Full-stack developer"},
            {"quote": "Shipping something every Friday built a confidence no tutorial ever gave me.", "author": "Tomás Reyes", "role": "Platform engineer"},
        ]}),
    ], name="Testimonials")

    apply_ = section([
        cols([
            box([
                heading_group("// apply", "Next cohort", "Applications are reviewed on a rolling basis. Pay upfront, in instalments, or once you're hired.", eyebrow_font=mono),
                el("countdown", {"doneText": "Applications for this cohort are closed."}, {"base": {"justifyContent": "flex-start"}}),
            ], base={"gap": 32}),
            el("pricing", {"columns": 2, "plans": [
                {"name": "Upfront", "price": "$11,900", "period": "one payment", "description": "Save $1,000 when you pay before the cohort starts.", "features": ["Full 12-week programme", "Career coaching", "Lifetime alumni access"], "button": {"label": "Apply", "href": "/signup"}},
                {"name": "After you're hired", "price": "$0", "period": "until you earn", "description": "Pay a share of income once you land a role above $50k.", "features": ["Same programme", "Capped total cost", "No job, no payment"], "highlighted": True, "badge": "Popular", "button": {"label": "Apply", "href": "/signup"}},
            ]}),
        ], ratio="2:3", gap=56, base={"alignItems": "flex-start"}),
    ], name="Apply", anchor="apply")

    faq = section([
        heading_group("// faq", "Questions, answered", align="center", eyebrow_font=mono),
        el("faq", {"layout": "accordion", "items": [
            {"question": "Do I need to know how to code?", "answer": "No, but you'll need to finish the free prep course before day one. Most people take two to three weeks."},
            {"question": "Is it really full-time?", "answer": "Yes. Expect 45 to 50 hours a week, live, with your cohort. A part-time track runs over 24 weeks."},
            {"question": "What happens after I graduate?", "answer": "Career coaches work with you for six months: portfolio, interviews, negotiation and introductions."},
        ]}, {"base": {"maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}),
    ], name="FAQ", base={"backgroundColor": "$surface"})
    return page(th, [hero, outcomes, syllabus, tracks, voices, apply_, faq], title="Twelve-week bootcamp", description="A full-time, project-first coding bootcamp with mentors and career support.")


# ─── 3. Corporate training ────────────────────────────────────────────────────


def corporate(ctx: dict) -> dict:
    org = _org(ctx, "our academy")
    th = theme(primary="#0f2a4a", secondary="#081a30", accent="#2f8cff", background="#ffffff", surface="#f3f6fa", text="#0d1b2a",
               muted="#56657a", border="#e1e7ef", heading="IBM Plex Sans", body="IBM Plex Sans", radius="md", button="solid", weight="600")
    hero = section([
        cols([
            box([
                eyebrow("Workforce learning", color="$accent"),
                h("Skills your teams use on Monday morning.", 1, base={"fontSize": "4rem", "lineHeight": 1.05, "letterSpacing": "-0.03em"}, tablet={"fontSize": "3.25rem"}, mobile={"fontSize": "2.5rem"}, animation=anim("slide-up")),
                t(f"{org} runs onboarding, compliance and leadership programmes for growing companies. Assign learning, follow progress, and prove completion when the auditor asks.",
                  base={"fontSize": "1.125rem", "lineHeight": 1.7, "color": "$muted", "maxWidth": "540px"}),
                row([btn("Book a walkthrough", "#contact", icon="ArrowRight"), btn("See the programmes", "#courses", "outline")], gap=12, mobile={"flexDirection": "column", "alignItems": "stretch"}),
                row([icon("ShieldCheck", size=18, color="$accent"), t("SOC 2 aligned · SSO · Audit-ready reports", base={"fontSize": 14, "color": "$muted"})], gap=8),
            ], base={"gap": 24}),
            img(art("corporate-hero"), "A progress dashboard with team completion charts", base={"borderRadius": 14, "boxShadow": "xl"}, animation=anim("slide-in", 150, 900)),
        ], ratio="equal", gap=64),
    ], name="Hero", base={"backgroundGradient": {"from": "#f3f7fc", "to": "#ffffff", "angle": 180}}, pad=(96, 96))

    logos = section([
        t("Trusted by learning teams at", base={"textAlign": "center", "fontSize": 13, "color": "$muted", "letterSpacing": "0.08em", "textTransform": "uppercase"}),
        el("logos", {"grayscale": True, "size": "sm", "items": [{"src": f"/landing-logo-{i}.svg", "alt": f"Customer {i}"} for i in range(1, 6)]}),
    ], name="Logos", pad=(24, 72), inner={"gap": 24})

    pillars = section([
        heading_group("Programmes", "One platform for every kind of training", "Ready-made courses you can brand, or your own material turned into tracked learning.", align="center"),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 3, "gap": 20}, "tablet": {"gridColumns": 1}}, [
            feature(i, ti, tx, card={"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 28, "paddingRight": 28, "borderWidth": 1, "borderColor": "$border", "borderRadius": 14, "backgroundColor": "$background"},
                    tile={"backgroundColor": "#e8f1ff"}, icon_color="$accent")
            for i, ti, tx in (
                ("RocketLaunch" if False else "Rocket", "Onboarding", "New hires reach productivity weeks sooner with a guided first 30 days."),
                ("ShieldCheck", "Compliance", "Annual training with due dates, reminders and certificates on file."),
                ("UsersThree", "Leadership", "Cohort programmes for first-time managers, with live sessions and coaching."),
            )
        ]),
    ], name="Programmes", base={"backgroundColor": "$surface"})

    catalogue = section([
        row([heading_group("Course library", "Start a programme today"), btn("Full library", "/courses", "ghost", size="md", icon="ArrowRight", base={"color": "$accent"})],
            base={"justifyContent": "space-between", "alignItems": "flex-end"}),
        courses(limit=6, columns=3, card="border"),
    ], name="Courses", anchor="courses")

    proof = section([
        cols([
            box([
                heading_group("Results", "Measured, not assumed", "Learning teams see the difference in the first quarter.", eyebrow_color="#8fc1ff",
                              title_style={"color": "#ffffff"}, sub_style={"color": "#b6c4d6"}),
            ]),
            el("container", {}, {"base": {"display": "grid", "gridColumns": 2, "gap": 32}, "mobile": {"gridColumns": 1}}, [
                stat(v, lbl, value_style={"color": "#ffffff"}, label_style={"color": "#b6c4d6"})
                for v, lbl in (("3×", "Faster onboarding"), ("96%", "Compliance completion"), ("41%", "Less time spent on admin"), ("4.8/5", "Learner satisfaction"))
            ]),
        ], ratio="equal", gap=64),
    ], name="Results", base={"backgroundColor": "$primary", "color": "#ffffff"})

    contact = section([
        cols([
            box([
                heading_group("Talk to us", "See it with your own content", "Tell us about your team and we'll set up a pilot with two of your existing trainings."),
                box([row([icon("Check", size=18, weight="bold", color="$accent"), t(x, base={"fontSize": 15})], gap=10) for x in (
                    "A 30-minute walkthrough tailored to your use case", "A pilot workspace with your branding", "Pricing per active learner, no lock-in")], base={"gap": 12}),
            ], base={"gap": 28}),
            box([el("form", {"submitLabel": "Request a walkthrough", "successText": "Thanks, we'll be in touch within one working day.", "fields": [
                {"key": "name", "label": "Full name", "type": "text", "required": True},
                {"key": "email", "label": "Work email", "type": "email", "required": True},
                {"key": "company", "label": "Company", "type": "text"},
                {"key": "team_size", "label": "Team size", "type": "select", "options": ["1–50", "51–250", "251–1,000", "1,000+"]},
            ]})], base={"paddingTop": 32, "paddingBottom": 32, "paddingLeft": 32, "paddingRight": 32, "backgroundColor": "$background", "borderRadius": 16, "borderWidth": 1, "borderColor": "$border", "boxShadow": "lg"},
                mobile={"paddingLeft": 20, "paddingRight": 20}),
        ], ratio="equal", gap=64, base={"alignItems": "flex-start"}),
    ], name="Contact", anchor="contact", base={"backgroundColor": "$surface"})
    return page(th, [hero, logos, pillars, catalogue, proof, contact], title=f"{org} — training for teams", description="Onboarding, compliance and leadership training with progress tracking.")


# ─── 4. University department ─────────────────────────────────────────────────


def university(ctx: dict) -> dict:
    org = _org(ctx, "the School")
    th = theme(primary="#8c1c2b", secondary="#2b0f14", accent="#b98a2f", background="#fbfaf8", surface="#f2efe9", text="#1d1a17",
               muted="#615a52", border="#e3ddd3", heading="Libre Baskerville", body="Source Sans 3", radius="none", button="solid", weight="700")
    hero = section([
        box([
            eyebrow(f"{org} · Continuing & online education", color="$primary"),
            h("Rigorous teaching, open to anyone who wants to learn.", 1, base={"fontSize": "4rem", "lineHeight": 1.12, "letterSpacing": "-0.02em", "maxWidth": "980px"},
              tablet={"fontSize": "3.1rem"}, mobile={"fontSize": "2.2rem"}, animation=anim("fade")),
            divider("$primary"),
            cols([
                t("Our faculty teach the same material online that they teach on campus: lectures, readings, problem sets and office hours, organised into courses you can take for credit or for interest.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.75, "color": "$muted"}),
                row([btn("Browse courses", "/courses", icon="ArrowRight"), btn("Programmes", "#programmes", "outline")], gap=12, base={"justifyContent": "flex-end"},
                    mobile={"justifyContent": "flex-start", "flexDirection": "column", "alignItems": "stretch"}),
            ], ratio="3:2", gap=48),
        ], base={"gap": 28}),
        img(art("university-hero"), "Stone arches of a university courtyard", base={"aspectRatio": "21/9", "objectFit": "cover"}, mobile={"aspectRatio": "4/3"}, animation=anim("fade", 200, 1000)),
    ], name="Hero", pad=(88, 96))

    programmes = section([
        cols([
            heading_group("Programmes", "Certificates and pathways", "Sequences of courses designed by the faculty, recognised for continuing education credit."),
            box([t("Every programme is reviewed annually by the department's curriculum committee.", base={"fontStyle": "italic", "color": "$muted", "fontSize": 15})], base={"justifyContent": "flex-end"}),
        ], ratio="2:1", base={"alignItems": "flex-end"}),
        el("paths", {"source": "latest", "limit": 3, "columns": 3, "cardStyle": "border"}),
    ], name="Programmes", anchor="programmes", base={"backgroundColor": "$surface"})

    catalogue = section([
        heading_group("This term", "Open courses", "Self-paced with weekly readings, or follow the term calendar with your peers."),
        courses(limit=8, columns=4, card="minimal"),
    ], name="Courses")

    faculty = section([
        heading_group("Faculty", "Taught by the department", align="center"),
        el("instructors", {"layout": "cards", "columns": 4, "people": [
            {"name": "Prof. Amara Lindqvist", "role": "Chair, Environmental Systems", "bio": "Works on watershed modelling and teaches the introductory sequence."},
            {"name": "Dr. Rafael Okonkwo", "role": "Senior Lecturer, Statistics", "bio": "Twelve years of teaching applied methods to non-specialists."},
            {"name": "Dr. Mei Takahashi", "role": "Associate Professor, Policy", "bio": "Researches how evidence reaches public decision making."},
            {"name": "Dr. Lucas Ferreira", "role": "Lecturer, Data & Society", "bio": "Leads the department's open education initiative."},
        ]}),
    ], name="Faculty")

    events = section([
        cols([
            box([
                heading_group("Lectures & office hours", "Live with the faculty", "Public lectures, seminars and weekly office hours, streamed and recorded."),
                btn("Full calendar", "/calendar", "outline", size="md"),
            ], base={"gap": 24}),
            el("live_sessions", {"limit": 4, "layout": "list", "emptyText": "The next lecture series will be announced soon."}),
        ], ratio="2:3", gap=64, base={"alignItems": "flex-start"}),
    ], name="Lectures", base={"backgroundColor": "$surface"})

    admissions = section([
        box([
            eyebrow("Admissions", color="#e9c98b"),
            h("Enrol for the coming term", 2, base={"fontSize": "2.75rem", "lineHeight": 1.15, "color": "#ffffff"}, mobile={"fontSize": "2rem"}),
            t("No entry requirements for open courses. Credit-bearing certificates ask for a short statement of purpose.", base={"color": "#ead8db", "fontSize": 17, "maxWidth": "620px"}),
            row([btn("Create your account", "/signup", "secondary", icon="ArrowRight"), btn("Read the FAQ", "#faq", "outline", base={"color": "#ffffff"})], gap=12,
                mobile={"flexDirection": "column", "alignItems": "stretch"}),
        ], base={"gap": 20}),
    ], name="Admissions", base={"backgroundColor": "$primary", "color": "#ffffff"}, pad=(96, 96))

    faq = section([
        heading_group("Questions", "Studying with us"),
        el("faq", {"layout": "two-columns", "items": [
            {"question": "Can I earn academic credit?", "answer": "Certificate programmes carry continuing education units. Individual courses can be taken for interest."},
            {"question": "How much time does a course take?", "answer": "Plan for four to six hours a week over eight weeks, or go at your own pace."},
            {"question": "Are the courses taught by faculty?", "answer": "Yes. Every course is designed and taught by members of the department."},
            {"question": "Is financial support available?", "answer": "Fee waivers are available for students and for people between jobs."},
        ]}),
    ], name="FAQ", anchor="faq")
    return page(th, [hero, programmes, catalogue, faculty, events, admissions, faq], title=f"{org} — open courses", description="Faculty-taught online courses, certificates and public lectures.")


# ─── 5. Creator / coach ───────────────────────────────────────────────────────


def coach(ctx: dict) -> dict:
    th = theme(primary="#c4532d", secondary="#2a1a22", accent="#e8a87c", background="#fbf3ee", surface="#f5e6dc", text="#2a1a22",
               muted="#7a6168", border="#ecd8cb", heading="DM Serif Display", body="DM Sans", radius="xl", button="pill", weight="500")
    hero = section([
        cols([
            box([
                eyebrow("Coaching · Courses · Community", color="$primary"),
                h("Do your best work without burning out.", 1, base={"fontSize": "4.6rem", "lineHeight": 1.02, "letterSpacing": "-0.02em", "fontWeight": "400"},
                  tablet={"fontSize": "3.6rem"}, mobile={"fontSize": "2.8rem"}, animation=anim("slide-up")),
                t("I help creative professionals build calm, sustainable routines. Start with the free mini-course, then join the flagship programme when you're ready.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.7, "color": "$muted", "maxWidth": "500px"}),
                row([btn("Start the free course", "#course", icon="ArrowRight"), btn("Work with me", "#pricing", "ghost", base={"color": "$primary"})], gap=8,
                    mobile={"flexDirection": "column", "alignItems": "stretch"}),
                row([t("As featured in", base={"fontSize": 13, "color": "$muted"}), t("The Slow Studio · Makers Weekly · Craft & Mind", base={"fontSize": 13, "fontWeight": "600"})], gap=10),
            ], base={"gap": 26}),
            img(art("coach-portrait"), "Abstract portrait shapes in warm terracotta tones", base={"borderRadius": 32}, animation=anim("zoom", 150, 900)),
        ], ratio="equal", gap=64),
    ], name="Hero", pad=(88, 104))

    featured = section([
        box([
            cols([
                box([
                    eyebrow("The flagship programme", color="$accent"),
                    h("The Sustainable Studio", 2, base={"fontSize": "3rem", "fontWeight": "400", "color": "#fbf3ee"}, mobile={"fontSize": "2.2rem"}),
                    t("Six weeks to redesign how you plan, focus and rest. Video lessons, weekly live calls and a small group that keeps you honest.",
                      base={"color": "#e7d6d0", "fontSize": 17, "lineHeight": 1.7}),
                    el("list", {"marker": "check", "items": ["18 short video lessons", "Weekly live coaching calls", "Templates for planning and reflection", "Private community for alumni"]},
                       {"base": {"color": "#fbf3ee"}}),
                    row([btn("See the programme", "/courses", "secondary", icon="ArrowRight")]),
                ], base={"gap": 20}),
                el("course", {"layout": "card", "buttonLabel": "Start learning", "showDescription": True}),
            ], ratio="equal", gap=56),
        ], base={"paddingTop": 64, "paddingBottom": 64, "paddingLeft": 56, "paddingRight": 56, "backgroundColor": "$secondary", "borderRadius": 32},
            mobile={"paddingTop": 36, "paddingBottom": 36, "paddingLeft": 22, "paddingRight": 22}),
    ], name="Featured programme", anchor="course", pad=(24, 96))

    proof = section([
        heading_group("Kind words", "What changed for them", align="center", title_style={"fontWeight": "400"}),
        el("testimonials", {"layout": "carousel", "cardStyle": "flat", "items": [
            {"quote": "I stopped working weekends for the first time in five years, and my output went up.", "author": "Priya Raman", "role": "Illustrator", "rating": 5},
            {"quote": "Practical, warm and honest. The live calls were worth the price on their own.", "author": "Jonas Weber", "role": "Product designer", "rating": 5},
            {"quote": "The planning templates are now the backbone of my studio.", "author": "Camille Durand", "role": "Ceramicist", "rating": 5},
            {"quote": "It felt like a friend who has been there showing me the way.", "author": "Ade Bankole", "role": "Writer", "rating": 5},
        ]}),
    ], name="Testimonials", base={"backgroundColor": "$surface"})

    pricing = section([
        heading_group("Ways to work together", "Pick what fits this season", align="center", title_style={"fontWeight": "400"}),
        el("pricing", {"columns": 3, "plans": [
            {"name": "Mini-course", "price": "Free", "period": "", "description": "Five emails, five small changes.", "features": ["5 short lessons", "Planning worksheet"], "button": {"label": "Start free", "href": "/signup"}},
            {"name": "The Sustainable Studio", "price": "$290", "period": "one time", "description": "The full six-week programme.", "features": ["18 lessons", "6 live calls", "Alumni community"], "highlighted": True, "badge": "Most chosen", "button": {"label": "Join the programme", "href": "/courses"}},
            {"name": "1:1 coaching", "price": "$180", "period": "per session", "description": "Focused sessions for a specific challenge.", "features": ["60-minute call", "Written follow-up"], "button": {"label": "Book a call", "href": "#newsletter"}},
        ]}),
    ], name="Pricing", anchor="pricing")

    letter = section([
        box([
            h("A letter every Sunday", 2, base={"fontSize": "2.5rem", "fontWeight": "400", "textAlign": "center"}, mobile={"fontSize": "2rem"}),
            t("One idea about working well, one thing I'm reading, one question to sit with. No spam, ever.", base={"textAlign": "center", "color": "$muted", "fontSize": 17}),
            el("newsletter", {"placeholder": "Your email", "buttonLabel": "Subscribe", "successText": "You're in. See you on Sunday.", "layout": "inline"},
               {"base": {"maxWidth": "480px", "marginLeft": "auto", "marginRight": "auto", "width": "100%"}}),
        ], base={"gap": 18, "alignItems": "center"}),
    ], name="Newsletter", anchor="newsletter", base={"backgroundColor": "$surface"})
    return page(th, [hero, featured, proof, pricing, letter], title="Courses and coaching", description="Calm, practical courses and coaching for creative professionals.")


# ─── 6. Language school ───────────────────────────────────────────────────────


def language(ctx: dict) -> dict:
    org = _org(ctx, "our school")
    th = theme(primary="#2747d1", secondary="#14205e", accent="#ff6a3d", background="#fffaf0", surface="#fff0d6", text="#141a33",
               muted="#5c6280", border="#f0e2c4", heading="Bricolage Grotesque", body="Figtree", radius="xl", button="pill", weight="800")
    hero = section([
        cols([
            box([
                row([t(x, base={"fontSize": 13, "fontWeight": "700", "paddingTop": 6, "paddingBottom": 6, "paddingLeft": 12, "paddingRight": 12, "borderRadius": 999,
                                 "backgroundColor": bg, "color": fg}) for x, bg, fg in (("Hola", "#ffe1d6", "#b23b17"), ("Bonjour", "#dfe6ff", "#1f3aa8"), ("Ciao", "#ffeab3", "#7a5300"), ("こんにちは", "#e3f5e8", "#1d6b3a"))], gap=8),
                h("Speak with confidence in months, not years.", 1, base={"fontSize": "4.4rem", "lineHeight": 1.02, "letterSpacing": "-0.04em"}, tablet={"fontSize": "3.5rem"}, mobile={"fontSize": "2.6rem"}, animation=anim("slide-up")),
                t(f"Small live classes with native teachers, bite-sized lessons between them, and conversation clubs every evening. {org} gets you talking from day one.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.65, "color": "$muted", "maxWidth": "520px"}),
                row([btn("Take the free level test", "/signup", icon="ArrowRight"), btn("See the courses", "#courses", "outline", base={"color": "$primary"})], gap=10,
                    mobile={"flexDirection": "column", "alignItems": "stretch"}),
            ], base={"gap": 24}),
            img(art("language-hero"), "Speech bubbles in many colours overlapping", animation=anim("zoom", 150, 900)),
        ], ratio="equal", gap=56),
    ], name="Hero", pad=(80, 96))

    levels = section([
        heading_group("Find your level", "From first words to fluent", "Every course maps to the CEFR scale, so you always know where you stand.", align="center"),
        el("container", {}, {"base": {"display": "grid", "gridColumns": 6, "gap": 12}, "tablet": {"gridColumns": 3}, "mobile": {"gridColumns": 2}}, [
            box([t(lvl, base={"fontFamily": "heading", "fontSize": "2rem", "fontWeight": "800", "color": fg}), t(desc, base={"fontSize": 13, "color": "$text", "lineHeight": 1.45})],
                base={"gap": 6, "paddingTop": 20, "paddingBottom": 20, "paddingLeft": 18, "paddingRight": 18, "borderRadius": 20, "backgroundColor": bg})
            for lvl, desc, bg, fg in (("A1", "Greetings, numbers, getting around", "#dfe6ff", "#2747d1"), ("A2", "Everyday chats and small talk", "#ffe1d6", "#c2410c"),
                                      ("B1", "Opinions, stories and travel", "#ffeab3", "#8a5a00"), ("B2", "Work meetings and the news", "#e3f5e8", "#1d6b3a"),
                                      ("C1", "Nuance, humour and debate", "#f1e3ff", "#6b21a8"), ("C2", "Near-native precision", "#ffe0ec", "#be185d"))
        ]),
    ], name="Levels", base={"backgroundColor": "$surface"})

    catalogue = section([
        heading_group("Courses", "Pick a language, start this week"),
        courses(limit=6, columns=3, card="shadow"),
    ], name="Courses", anchor="courses")

    clubs = section([
        cols([
            box([
                heading_group("Conversation clubs", "Practise out loud, every evening", "Drop into a 45-minute club led by a teacher. Themes change daily: cooking, films, job interviews, travel stories.",
                              eyebrow_color="#ffb199", title_style={"color": "#fffaf0"}, sub_style={"color": "#c7cdee"}),
                row([icon("ChatsCircle", size=22, color="$accent"), t("Included with every membership", base={"fontWeight": "600"})], gap=10),
            ], base={"gap": 24}),
            el("live_sessions", {"limit": 4, "layout": "list", "emptyText": "New clubs are published every Monday."}),
        ], ratio="equal", gap=56, base={"alignItems": "flex-start"}),
    ], name="Conversation clubs", base={"backgroundColor": "#14205e", "color": "#fffaf0"})

    pricing = section([
        heading_group("Membership", "Simple, monthly, cancel anytime", align="center"),
        el("pricing", {"columns": 3, "plans": [
            {"name": "Self-study", "price": "$12", "period": "/ month", "description": "All recorded lessons and exercises.", "features": ["Every language", "Progress tracking"], "button": {"label": "Start", "href": "/signup"}},
            {"name": "Classes", "price": "$59", "period": "/ month", "description": "Two live classes a week plus everything in self-study.", "features": ["Groups of six", "Native teachers", "Unlimited clubs"], "highlighted": True, "badge": "Best value", "button": {"label": "Join", "href": "/signup"}},
            {"name": "Private", "price": "$34", "period": "/ lesson", "description": "One-to-one lessons at your pace.", "features": ["Choose your teacher", "Flexible times"], "button": {"label": "Book", "href": "/signup"}},
        ]}),
        el("testimonials", {"layout": "single", "items": [{"quote": "Six months ago I couldn't order a coffee in Lisbon. Last week I gave a presentation in Portuguese.", "author": "Nadia Kowalczyk", "role": "Learning Portuguese, B1", "rating": 5}]}),
    ], name="Pricing")
    return page(th, [hero, levels, catalogue, clubs, pricing], title=f"{org} — live language classes", description="Small live classes, short lessons and daily conversation clubs.")


# ─── 7. Health / CE credits ───────────────────────────────────────────────────


def health(ctx: dict) -> dict:
    org = _org(ctx, "the Institute")
    th = theme(primary="#0e7c7b", secondary="#073b3a", accent="#3bb7a5", background="#ffffff", surface="#eef7f6", text="#10262a",
               muted="#526a6e", border="#d7e8e6", heading="Plus Jakarta Sans", body="Plus Jakarta Sans", radius="lg", button="solid", weight="700")
    hero = section([
        cols([
            box([
                row([row([icon("Seal", size=18, color="$primary"), t("Accredited continuing education", base={"fontSize": 14, "fontWeight": "600", "color": "$primary"})], gap=8,
                         base={"paddingTop": 6, "paddingBottom": 6, "paddingLeft": 12, "paddingRight": 12, "borderRadius": 999, "backgroundColor": "$surface"})]),
                h("Earn your CE credits from evidence you'll actually use.", 1, base={"fontSize": "3.9rem", "lineHeight": 1.06, "letterSpacing": "-0.035em"}, tablet={"fontSize": "3.1rem"}, mobile={"fontSize": "2.4rem"}, animation=anim("slide-up")),
                t("Clinically reviewed courses for nurses, physicians and allied health professionals. Learn between shifts, pass the assessment, and download your certificate the same day.",
                  base={"fontSize": "1.125rem", "lineHeight": 1.7, "color": "$muted", "maxWidth": "540px"}),
                row([btn("Browse accredited courses", "#courses", icon="ArrowRight"), btn("How credits work", "#credits", "outline")], gap=12, mobile={"flexDirection": "column", "alignItems": "stretch"}),
            ], base={"gap": 24}),
            img(art("health-hero"), "A calm abstract of a heartbeat line and a certificate", base={"borderRadius": 24}, animation=anim("fade", 150, 900)),
        ], ratio="equal", gap=56),
    ], name="Hero", pad=(88, 88))

    trust = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 4, "gap": 24}, "tablet": {"gridColumns": 2}, "mobile": {"gridColumns": 1}}, [
            row([box([icon(i, size=22, color="$primary")], base={"width": 44, "height": 44, "alignItems": "center", "justifyContent": "center", "borderRadius": 12, "backgroundColor": "#ffffff"}),
                 box([t(v, base={"fontWeight": "700", "fontSize": 17}), t(lbl, base={"fontSize": 13, "color": "$muted"})], base={"gap": 2})], gap=14, wrap=False)
            for i, v, lbl in (("Certificate", "150+ credit hours", "Across 20 specialties"), ("ShieldCheck", "Peer reviewed", "By practising clinicians"),
                            ("Clock", "Learn in 20-minute blocks", "On any device"), ("Exam", "Instant certificates", "Recorded to your profile"))
        ]),
    ], name="Highlights", base={"backgroundColor": "$surface"}, pad=(40, 40), mpad=(32, 32))

    catalogue = section([
        row([heading_group("Accredited courses", "Start earning credit today", "Every course lists its credit hours, learning objectives and the reviewing faculty."),
             btn("All courses", "/courses", "outline", size="md")], base={"justifyContent": "space-between", "alignItems": "flex-end"}),
        courses(limit=6, columns=3, card="border"),
    ], name="Courses", anchor="courses")

    how = section([
        heading_group("How credits work", "From first lesson to certificate in four steps", align="center"),
        el("steps", {"layout": "horizontal", "items": [
            {"title": "Choose a course", "text": "Filter by specialty, credit type and length."},
            {"title": "Learn at your pace", "text": "Short modules with case studies and knowledge checks."},
            {"title": "Pass the assessment", "text": "Score 80% or more. Retakes are free."},
            {"title": "Download your certificate", "text": "Instantly, with a verification code for your board."},
        ]}),
        img(art("health-cert"), "A certificate with a verification seal", base={"maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto", "borderRadius": 20, "boxShadow": "lg"}),
    ], name="How it works", anchor="credits", base={"backgroundColor": "$surface"})

    faq = section([
        cols([
            heading_group("FAQ", "Questions from clinicians"),
            el("faq", {"items": [
                {"question": "Which boards accept your credits?", "answer": "Our courses are accredited for nursing, medicine and several allied health boards. Each course page lists its accreditation."},
                {"question": "Can my employer pay for my courses?", "answer": "Yes. Teams get a shared account, invoicing and a completion report for every learner."},
                {"question": "How long do I keep access?", "answer": "For as long as your account is active, including every certificate you've earned."},
                {"question": "Are the courses up to date?", "answer": "Every course is reviewed at least once a year and whenever guidelines change."},
            ]}),
        ], ratio="1:2", gap=56, base={"alignItems": "flex-start"}),
    ], name="FAQ")

    cta = section([
        box([
            h("Keep your licence current without losing your evenings.", 2, base={"fontSize": "2.6rem", "lineHeight": 1.15, "color": "#ffffff", "textAlign": "center"}, mobile={"fontSize": "1.9rem"}),
            row([btn("Create a free account", "/signup", "secondary", icon="ArrowRight")], base={"justifyContent": "center"}),
        ], base={"gap": 24, "alignItems": "center", "maxWidth": "760px", "marginLeft": "auto", "marginRight": "auto"}),
    ], name="Call to action", base={"backgroundGradient": {"from": "#0e7c7b", "to": "#073b3a", "angle": 135}, "color": "#ffffff"}, pad=(96, 96))
    return page(th, [hero, trust, catalogue, how, faq, cta], title=f"{org} — accredited CE courses", description="Clinically reviewed continuing education with instant certificates.")


# ─── 8. Coding school ─────────────────────────────────────────────────────────


def coding(ctx: dict) -> dict:
    org = _org(ctx, "the school")
    mono = "IBM Plex Mono"
    th = theme(primary="#6d4aff", secondary="#121212", accent="#ffb224", background="#fafaf7", surface="#f0efe9", text="#121212",
               muted="#5d5d58", border="#e2e1da", heading="Space Grotesk", body="Inter", radius="md", button="solid", width="wide", weight="700")
    hero = section([
        cols([
            box([
                t("$ learn --by-building", base={"fontFamily": mono, "fontSize": 14, "color": "$primary"}),
                h("Learn to code by shipping things people use.", 1, base={"fontSize": "4.6rem", "lineHeight": 1.0, "letterSpacing": "-0.045em"}, tablet={"fontSize": "3.5rem"}, mobile={"fontSize": "2.6rem"}, animation=anim("slide-up")),
                t(f"Interactive courses, real projects and reviews from senior engineers. {org} takes you from your first function to your first pull request.",
                  base={"fontSize": "1.1875rem", "lineHeight": 1.65, "color": "$muted", "maxWidth": "540px"}),
                row([btn("Start coding free", "/signup", icon="ArrowRight"), btn("View learning paths", "#paths", "secondary")], gap=12, mobile={"flexDirection": "column", "alignItems": "stretch"}),
                row([t(x, base={"fontFamily": mono, "fontSize": 12, "color": "$muted", "paddingTop": 4, "paddingBottom": 4, "paddingLeft": 10, "paddingRight": 10, "borderWidth": 1, "borderColor": "$border", "borderRadius": 6})
                     for x in ("Python", "JavaScript", "SQL", "Go", "Rust")], gap=8),
            ], base={"gap": 24}),
            img(art("coding-hero"), "An editor window with highlighted code next to a passing test run", base={"borderRadius": 14, "boxShadow": "xl"}, animation=anim("slide-in", 150, 900)),
        ], ratio="equal", gap=56),
    ], name="Hero", base={"backgroundImage": art("coding-grid"), "backgroundSize": "auto", "backgroundPosition": "top"}, pad=(96, 96))

    paths = section([
        heading_group("Paths", "Choose where you want to end up", "Each path is a sequence of courses and projects, ending in a capstone a hiring manager would recognise.", eyebrow_font=mono),
        el("paths", {"source": "latest", "limit": 3, "columns": 3, "cardStyle": "border"}),
    ], name="Paths", anchor="paths")

    why = section([
        el("container", {}, {"base": {"display": "grid", "gridColumns": 3, "gap": 0, "borderWidth": 1, "borderColor": "$border", "borderRadius": 16, "backgroundColor": "$background", "overflow": "hidden"},
                             "tablet": {"gridColumns": 1}}, [
            feature(i, ti, tx, card={"paddingTop": 36, "paddingBottom": 36, "paddingLeft": 32, "paddingRight": 32}, tile={"backgroundColor": "#efeaff"})
            for i, ti, tx in (("Code", "Write code in the browser", "Every lesson runs real code. No setup, no installs, instant feedback."),
                              ("GithubLogo", "Build a real portfolio", "Projects live in your own repositories, reviewed like production code."),
                              ("Users", "Never get stuck alone", "Ask in the community or book a 20-minute pairing session with a mentor."))
        ]),
    ], name="Why", base={"backgroundColor": "$surface"})

    catalogue = section([
        heading_group("Courses", "Popular right now", eyebrow_font=mono),
        courses(limit=8, columns=4, card="shadow"),
    ], name="Courses")

    projects = section([
        heading_group("Built by students", "Projects from this month", align="center", eyebrow_font=mono),
        el("gallery", {"columns": 3, "images": [{"src": art(f"coding-project-{i}"), "alt": alt} for i, alt in ((1, "A weather dashboard"), (2, "A habit tracking app"), (3, "A data visualisation of city transit"))]}),
        el("testimonials", {"layout": "grid", "columns": 2, "cardStyle": "border", "items": [
            {"quote": "The reviews are blunt and kind at the same time. My code got better every single week.", "author": "Yuki Nakamura", "role": "Backend developer"},
            {"quote": "I tried four platforms. This is the one where I actually built things.", "author": "Samuel Adeyemi", "role": "Data engineer"},
        ]}),
    ], name="Projects")

    cta = section([
        cols([
            box([
                t("> ready?", base={"fontFamily": mono, "color": "$accent", "fontSize": 15}),
                h("Your first lesson takes eight minutes.", 2, base={"fontSize": "3rem", "lineHeight": 1.05, "color": "#fafaf7"}, mobile={"fontSize": "2.1rem"}),
            ], base={"gap": 12}),
            row([btn("Start coding free", "/signup", icon="ArrowRight"), btn("Browse courses", "/courses", "outline", base={"color": "#fafaf7"})], gap=12, base={"justifyContent": "flex-end"},
                mobile={"justifyContent": "flex-start", "flexDirection": "column", "alignItems": "stretch"}),
        ], ratio="equal", gap=40),
    ], name="Call to action", base={"backgroundColor": "$secondary", "color": "#fafaf7"}, pad=(88, 88))
    return page(th, [hero, paths, why, catalogue, projects, cta], title=f"{org} — learn to code", description="Interactive coding courses, real projects and mentor reviews.")
