from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.payments.payments_courses import PaymentsCourse
from src.db.payments.payments_products import PaymentsProduct
from src.db.courses.courses import Course
from src.db.users import PublicUser, AnonymousUser
from src.security.courses_security import courses_rbac_check

async def link_course_to_product(
    request: Request,
    org_id: int,
    course_id: int,
    product_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Check if course exists and user has permission
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # RBAC check
    await courses_rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Check if product exists
    statement = select(PaymentsProduct).where(
        PaymentsProduct.id == product_id,
        PaymentsProduct.org_id == org_id
    )
    product = db_session.exec(statement).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Check if course is already linked to another product
    statement = select(PaymentsCourse).where(PaymentsCourse.course_id == course.id)
    existing_link = db_session.exec(statement).first()

    if existing_link:
        raise HTTPException(
            status_code=400,
            detail="Course is already linked to a product"
        )

    # Create new payment course link
    payment_course = PaymentsCourse(
        course_id=course.id,  # type: ignore
        payment_product_id=product_id,
        org_id=org_id,
    )

    db_session.add(payment_course)
    db_session.commit()

    return {"message": "Course linked to product successfully"}

async def unlink_course_from_product(
    request: Request,
    org_id: int,
    course_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Check if course exists and user has permission
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # RBAC check
    await courses_rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Find and delete the payment course link
    statement = select(PaymentsCourse).where(
        PaymentsCourse.course_id == course.id,
        PaymentsCourse.org_id == org_id
    )
    payment_course = db_session.exec(statement).first()

    if not payment_course:
        raise HTTPException(
            status_code=404,
            detail="Course is not linked to any product"
        )

    db_session.delete(payment_course)
    db_session.commit()

    return {"message": "Course unlinked from product successfully"}

async def get_courses_by_product(
    request: Request,
    org_id: int,
    product_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Check if product exists
    statement = select(PaymentsProduct).where(
        PaymentsProduct.id == product_id,
        PaymentsProduct.org_id == org_id
    )
    product = db_session.exec(statement).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Get all courses linked to this product with explicit join
    statement = (
        select(Course)
        .select_from(Course)
        .join(PaymentsCourse, Course.id == PaymentsCourse.course_id)  # type: ignore
        .where(
            PaymentsCourse.payment_product_id == product_id,
            PaymentsCourse.org_id == org_id
        )
    )
    courses = db_session.exec(statement).all()

    return courses
