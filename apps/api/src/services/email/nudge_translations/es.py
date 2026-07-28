"""Spanish nudge copy."""

STRINGS: dict[str, str] = {
    "nudge.common.unsubscribe": "Cancelar la suscripción a estos correos",
    "nudge.common.footer": "Recibes este correo porque eres administrador de {org_name}.",

    # Stat-strip labels. A label beside a bare number needs no plural
    # agreement, which is why the figures are not written into prose.
    "nudge.stat.courses": "Cursos",
    "nudge.stat.chapters": "Capítulos",
    "nudge.stat.lessons": "Lecciones",
    "nudge.stat.members": "Miembros",
    "nudge.stat.learners": "Estudiantes",
    "nudge.stat.completed": "Completados",

    "nudge.activation.first_course_d1.subject": "Tu primer curso en {org_name}",
    "nudge.activation.first_course_d1.heading": "Cuando quieras",
    "nudge.activation.first_course_d1.body": "{org_name} está listo y esperando su primer curso. La mayoría empieza con poco: un tema, unas cuantas lecciones. Siempre puedes ampliarlo después.",
    "nudge.activation.first_course_d1.cta": "Crear tu primer curso",

    "nudge.activation.come_back_d2.subject": "Retomar donde lo dejaste",
    "nudge.activation.come_back_d2.heading": "Tu espacio sigue esperando",
    "nudge.activation.come_back_d2.body": "Creaste {org_name} y no has vuelto desde entonces. Todo sigue ahí, y poner un primer curso en marcha lleva unos diez minutos.",
    "nudge.activation.come_back_d2.cta": "Ir al panel",

    "nudge.activation.ai_course_help_d4.subject": "La página en blanco es lo difícil",
    "nudge.activation.ai_course_help_d4.heading": "Deja que la IA escriba el esquema",
    "nudge.activation.ai_course_help_d4.body": "Si {org_name} sigue vacío porque no sabes por dónde empezar, describe tu tema y la IA redactará los capítulos y las lecciones. A partir de ahí, editas tú.",
    "nudge.activation.ai_course_help_d4.cta": "Crear un curso con IA",

    "nudge.activation.import_existing_d5.subject": "Trae lo que ya tienes",
    "nudge.activation.import_existing_d5.heading": "No hace falta empezar de cero",
    "nudge.activation.import_existing_d5.body": "Si tu material ya existe como documentos, diapositivas o una exportación de otra plataforma, puedes traerlo a {org_name} en lugar de volver a escribirlo.",
    "nudge.activation.import_existing_d5.cta": "Importar tu material",

    "nudge.activation.setup_checklist_d7.subject": "Quince minutos para una academia lista",
    "nudge.activation.setup_checklist_d7.heading": "Una lista breve",
    "nudge.activation.setup_checklist_d7.body": "{org_name} sigue esperando su primer curso. La lista de configuración te guía en unos pocos pasos; la mayoría termina en un cuarto de hora.",
    "nudge.activation.setup_checklist_d7.cta": "Abrir la lista",

    "nudge.activation.whats_blocking_d14.subject": "¿Qué se interpuso?",
    "nudge.activation.whats_blocking_d14.heading": "¿Podemos preguntarte qué te detuvo?",
    "nudge.activation.whats_blocking_d14.body": "Creaste {org_name} hace un par de semanas y aún no has añadido un curso. Si algo resultó confuso o faltaba, nos gustaría saberlo: responde a este correo y nos llega directamente.",

    "nudge.activation.last_call_d30.subject": "Último correo sobre {org_name}",
    "nudge.activation.last_call_d30.heading": "Este es el último",
    "nudge.activation.last_call_d30.body": "{org_name} lleva un mes en silencio, así que dejaremos de enviar estos correos. Tu cuenta y todo lo que contiene se queda igual: si vuelves, lo encontrarás donde lo dejaste.",
    "nudge.activation.last_call_d30.cta": "Abrir tu panel",

    "nudge.content.course_no_chapter_d1.subject": "{course_name} necesita su primer capítulo",
    "nudge.content.course_no_chapter_d1.heading": "Falta un capítulo",
    "nudge.content.course_no_chapter_d1.body": "{course_name} existe pero aún no tiene capítulos, así que no hay nada que abrir. Los capítulos son simplemente secciones: uno por tema funciona bien.",
    "nudge.content.course_no_chapter_d1.cta": "Añadir un capítulo",

    "nudge.content.chapter_no_activity_d1.subject": "Añade tu primera lección a {course_name}",
    "nudge.content.chapter_no_activity_d1.heading": "Los capítulos están listos",
    "nudge.content.chapter_no_activity_d1.body": "{course_name} tiene capítulos, pero todavía están vacíos. Una lección puede ser una página de texto, un vídeo, un cuestionario: lo que encaje con el tema.",
    "nudge.content.chapter_no_activity_d1.cta": "Añadir una lección",

    "nudge.content.activity_unpublished_d2.subject": "Tus lecciones en {course_name} aún no se ven",
    "nudge.content.activity_unpublished_d2.heading": "Las lecciones siguen ocultas",
    "nudge.content.activity_unpublished_d2.body": "Has escrito lecciones en {course_name}, pero ninguna está publicada, así que quien entre verá un curso vacío. Publicar no bloquea nada: puedes seguir editando.",
    "nudge.content.activity_unpublished_d2.cta": "Publicar tus lecciones",

    "nudge.content.course_draft_d3.subject": "{course_name} sigue siendo un borrador",
    "nudge.content.course_draft_d3.heading": "{course_name} está casi listo",
    "nudge.content.course_draft_d3.body": "Has añadido lecciones a {course_name}, pero no está publicado, así que nadie puede abrirlo. No hace falta que esté terminado: publicar solo lo hace visible, y puedes seguir editándolo.",
    "nudge.content.course_draft_d3.cta": "Publicarlo",

    "nudge.content.course_draft_d10.subject": "{course_name} lleva tiempo como borrador",
    "nudge.content.course_draft_d10.heading": "Seguramente ya está",
    "nudge.content.course_draft_d10.body": "{course_name} lleva más de una semana sin publicar. Un curso rara vez se siente terminado: publicarlo lo hace visible, y puedes seguir mejorándolo mientras alguien ya lo lee.",
    "nudge.content.course_draft_d10.cta": "Publicarlo",

    "nudge.content.thin_course_d5.subject": "{course_name} pide un poco más",
    "nudge.content.thin_course_d5.heading": "Una o dos lecciones",
    "nudge.content.thin_course_d5.body": "{course_name} tiene una o dos lecciones por ahora. Los cursos funcionan mejor con unas cuantas más, y la IA puede redactar las siguientes a partir de lo que ya hay.",
    "nudge.content.thin_course_d5.cta": "Añadir más lecciones",

    "nudge.content.assignment_no_submissions_d5.subject": "Aún no hay entregas en {org_name}",
    "nudge.content.assignment_no_submissions_d5.heading": "Nadie ha entregado nada",
    "nudge.content.assignment_no_submissions_d5.body": "Creaste una tarea en {org_name} pero no se ha entregado nada. Conviene comprobar que está publicada y que tus estudiantes pueden llegar al curso al que pertenece.",
    "nudge.content.assignment_no_submissions_d5.cta": "Revisar tus tareas",

    "nudge.audience.published_no_members_d1.subject": "{course_name} está publicado, pero no hay nadie",
    "nudge.audience.published_no_members_d1.heading": "Es momento de invitar a alguien",
    "nudge.audience.published_no_members_d1.body": "{course_name} está publicado y listo para leer. {org_name} todavía no tiene estudiantes, así que el siguiente paso es invitar a las personas para quienes lo escribiste.",
    "nudge.audience.published_no_members_d1.cta": "Invitar estudiantes",

    "nudge.audience.published_no_members_d7.subject": "{course_name} sigue sin estudiantes",
    "nudge.audience.published_no_members_d7.heading": "Una semana publicado y nadie lo lee",
    "nudge.audience.published_no_members_d7.body": "{course_name} lleva una semana publicado y {org_name} sigue sin estudiantes. Puedes invitar de uno en uno, pegar una lista o simplemente compartir el enlace para unirse.",
    "nudge.audience.published_no_members_d7.cta": "Invitar personas",

    "nudge.audience.members_no_enrollment_d3.subject": "Tus estudiantes aún no han empezado",
    "nudge.audience.members_no_enrollment_d3.heading": "Se unieron pero no han abierto nada",
    "nudge.audience.members_no_enrollment_d3.body": "Hay gente que se ha unido a {org_name} pero nadie ha empezado un curso. Un mensaje corto con un enlace directo suele bastar: la mayoría simplemente no ha encontrado la entrada.",
    "nudge.audience.members_no_enrollment_d3.cta": "Ver tus miembros",

    "nudge.audience.share_public_page_d14.subject": "Tu página de curso es pública: aquí tienes el enlace",
    "nudge.audience.share_public_page_d14.heading": "Cualquiera con el enlace puede leerlo",
    "nudge.audience.share_public_page_d14.body": "{course_name} es público, así que puedes compartirlo donde quieras sin que nadie necesite una invitación. El enlace de abajo es el que hay que enviar.",
    "nudge.audience.share_public_page_d14.cta": "Ver la página pública",

    "nudge.audience.stalled_learners_d14.subject": "Algunos estudiantes se quedaron a medias",
    "nudge.audience.stalled_learners_d14.heading": "Unos cuantos se han detenido",
    "nudge.audience.stalled_learners_d14.body": "Algunos estudiantes de {org_name} empezaron un curso y llevan un par de semanas sin volver. Suele ayudar un mensaje tuyo, o mirar dónde se detuvieron.",
    "nudge.audience.stalled_learners_d14.cta": "Ver tus estudiantes",

    "nudge.monetization.course_limit_d1.subject": "Has usado todos los cursos del plan {plan_name}",
    "nudge.monetization.course_limit_d1.heading": "Has alcanzado el límite de cursos",
    "nudge.monetization.course_limit_d1.body": "{org_name} está en el plan {plan_name} y ha usado todos los cursos que incluye. Pasar a {next_plan} elimina ese límite si quieres seguir creando.",
    "nudge.monetization.course_limit_d1.cta": "Ver planes",

    "nudge.monetization.member_limit_near.subject": "Estás cerca del límite de miembros del plan {plan_name}",
    "nudge.monetization.member_limit_near.heading": "Casi en el límite de miembros",
    "nudge.monetization.member_limit_near.body": "{org_name} se acerca al número de miembros que permite el plan {plan_name}. Pasar a {next_plan} lo amplía, para que nadie se quede fuera a mitad del registro.",
    "nudge.monetization.member_limit_near.cta": "Ver planes",

    "nudge.monetization.ai_credits_low.subject": "Tus créditos de IA están casi agotados",
    "nudge.monetization.ai_credits_low.heading": "Quedan pocos créditos de IA",
    "nudge.monetization.ai_credits_low.body": "{org_name} ha usado la mayoría de los créditos de IA incluidos en el plan {plan_name}. El plan {next_plan} incluye más, si la IA ya forma parte de cómo creas cursos.",
    "nudge.monetization.ai_credits_low.cta": "Ver planes",

    "nudge.monetization.upgrade_recap_d21.subject": "Lo que {next_plan} aportaría a {org_name}",
    "nudge.monetization.upgrade_recap_d21.heading": "Has construido algo sólido",
    "nudge.monetization.upgrade_recap_d21.body": "{org_name} tiene cursos publicados y gente leyéndolos. El plan {next_plan} añade margen para crecer y algunas cosas que el plan {plan_name} no incluye: vale la pena mirarlo si piensas ampliar.",
    "nudge.monetization.upgrade_recap_d21.cta": "Comparar planes",

    "nudge.dormancy.no_login_14d.subject": "{org_name} ha estado en silencio",
    "nudge.dormancy.no_login_14d.heading": "Han pasado un par de semanas",
    "nudge.dormancy.no_login_14d.body": "Nada ha cambiado en {org_name} desde tu última visita. Si estabas a mitad de algo, sigue exactamente donde lo dejaste.",
    "nudge.dormancy.no_login_14d.cta": "Abrir tu panel",

    "nudge.dormancy.no_login_30d.subject": "Tus cursos en {org_name} siguen aquí",
    "nudge.dormancy.no_login_30d.heading": "Han pasado unas semanas",
    "nudge.dormancy.no_login_30d.body": "Nada ha cambiado mientras no estabas: {org_name} y todo lo que contiene está exactamente donde lo dejaste. Retomarlo es cuestión de un clic.",
    "nudge.dormancy.no_login_30d.cta": "Abrir tu panel",

    "nudge.dormancy.no_login_60d.subject": "Último mensaje sobre {org_name}",
    "nudge.dormancy.no_login_60d.heading": "Te dejamos tranquilo",
    "nudge.dormancy.no_login_60d.body": "{org_name} lleva un par de meses en silencio, así que este es el último de estos correos por ahora. Todo lo que construiste se queda tal cual, para cuando lo necesites.",
    "nudge.dormancy.no_login_60d.cta": "Abrir tu panel",

    "nudge.dormancy.winback_q.subject": "Qué hay de nuevo desde tu última visita a {org_name}",
    "nudge.dormancy.winback_q.heading": "Han cambiado algunas cosas",
    "nudge.dormancy.winback_q.body": "Hace tiempo que no pasas por {org_name}. El producto ha avanzado bastante desde entonces, y todo lo que construiste sigue ahí.",
    "nudge.dormancy.winback_q.cta": "Echar un vistazo",

    "nudge.milestone.first_course_published.subject": "{course_name} está publicado",
    "nudge.milestone.first_course_published.heading": "Has publicado tu primer curso",
    "nudge.milestone.first_course_published.body": "{course_name} está publicado y se puede leer. Lo siguiente que marca la diferencia es tener a alguien que lo lea, aunque sean una o dos personas para empezar.",
    "nudge.milestone.first_course_published.cta": "Invitar a tus primeros estudiantes",

    "nudge.milestone.first_learner_enrolled.subject": "Alguien ha empezado {course_name}",
    "nudge.milestone.first_learner_enrolled.heading": "Tu primer estudiante ya está dentro",
    "nudge.milestone.first_learner_enrolled.body": "Por primera vez alguien ha empezado un curso en {org_name}. Puedes seguir cómo le va desde tu panel.",
    "nudge.milestone.first_learner_enrolled.cta": "Ver su progreso",

    "nudge.milestone.first_completion.subject": "Alguien ha terminado un curso en {org_name}",
    "nudge.milestone.first_completion.heading": "Primera finalización",
    "nudge.milestone.first_completion.body": "Un estudiante ha terminado un curso de {org_name} de principio a fin. Si quieres dejar constancia, puedes añadir un certificado, o empezar a preparar lo siguiente.",
    "nudge.milestone.first_completion.cta": "Abrir tu panel",

    # -- reactivation ------------------------------------------------------
    "nudge.reactivation.opener.subject": "Tu academia en {org_name} sigue aquí",
    "nudge.reactivation.opener.heading": "Sigue aquí, tal como la dejaste",
    "nudge.reactivation.opener.body": "Nadie ha tocado {org_name} desde tu última visita: cada curso, capítulo y lección está donde lo dejaste. Retomarlo es cuestión de un clic.",
    "nudge.reactivation.opener.cta": "Abrir tu panel",
    "nudge.reactivation.whats_changed.subject": "Han cambiado algunas cosas en LearnHouse",
    "nudge.reactivation.whats_changed.heading": "Desde tu última visita",
    "nudge.reactivation.whats_changed.body": "El producto ha avanzado bastante mientras {org_name} estaba en pausa: el editor, las herramientas de cursos y el recorrido de los estudiantes se han trabajado a fondo. Todo lo que creaste funciona igual que antes.",
    "nudge.reactivation.whats_changed.cta": "Ver las novedades",
    "nudge.reactivation.need_a_hand.subject": "¿Te echamos una mano para volver a {org_name}?",
    "nudge.reactivation.need_a_hand.heading": "¿Hubo algo que se interpuso?",
    "nudge.reactivation.need_a_hand.body": "Si hubo un motivo por el que {org_name} se detuvo —algo confuso, algo que faltaba o simplemente falta de tiempo— nos gustaría saberlo. Responde a este correo y nos llega directamente.",
    "nudge.reactivation.closing.subject": "Último mensaje sobre {org_name}",
    "nudge.reactivation.closing.heading": "Lo dejamos aquí",
    "nudge.reactivation.closing.body": "Este es el último de estos correos. {org_name} se queda exactamente como está y nada caduca: si algún día quieres volver, todo estará esperándote.",
    "nudge.reactivation.closing.cta": "Abrir tu panel",
}
