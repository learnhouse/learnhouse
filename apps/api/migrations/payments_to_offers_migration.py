"""
One-shot data migration script: migrate legacy PaymentsProduct / PaymentsCourse / PaymentsUser
rows to the new PaymentsOffer / PaymentsEnrollment architecture.

Run AFTER applying the Alembic migration n4c5d6e7f8a9_payments_offers_enrollments.py:

    python migrations/payments_to_offers_migration.py

What it does:
1. For each existing PaymentsProduct:
   a. Create a new UserGroup named "Offer: {product.name}" in the same org
   b. Create a PaymentsOffer pointing at that UserGroup
   c. Copy each PaymentsCourse row → UserGroupResource (links the course to the group)
   d. Copy each PaymentsUser row → PaymentsEnrollment with identical status

Old tables are left in place; they can be dropped once the migration is verified.
"""

import sys
import os

# Adjust path so we can import from the api package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from uuid import uuid4

from sqlmodel import Session, select, create_engine
from config.config import get_learnhouse_config

from src.db.usergroups import UserGroup
from src.db.usergroup_resources import UserGroupResource

from ee.db.payments.payments_products import PaymentsProduct
from ee.db.payments.payments_courses import PaymentsCourse
from ee.db.payments.payments_users import PaymentsUser, PaymentStatusEnum
from ee.db.payments.payments_offers import PaymentsOffer, OfferTypeEnum, OfferPriceTypeEnum
from ee.db.payments.payments_enrollments import PaymentsEnrollment, EnrollmentStatusEnum
from src.db.courses.courses import Course


def _status_map(old_status: PaymentStatusEnum) -> EnrollmentStatusEnum:
    return EnrollmentStatusEnum(old_status.value)


def run_migration(db_session: Session) -> None:
    products = db_session.exec(select(PaymentsProduct)).all()
    print(f"Found {len(products)} legacy products to migrate.")

    for product in products:
        print(f"\nMigrating product: id={product.id} name={product.name!r}")

        # 1. Create UserGroup
        ug = UserGroup(
            name=f"Offer: {product.name}",
            description=f"Auto-created for offer migrated from product #{product.id}",
            org_id=product.org_id,
            usergroup_uuid=f"usergroup_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(ug)
        db_session.flush()  # get ug.id
        print(f"  Created UserGroup id={ug.id}")

        # 2. Create PaymentsOffer
        offer_type = (
            OfferTypeEnum.SUBSCRIPTION
            if product.product_type.value == "subscription"
            else OfferTypeEnum.ONE_TIME
        )
        price_type = (
            OfferPriceTypeEnum.CUSTOMER_CHOICE
            if product.price_type.value == "customer_choice"
            else OfferPriceTypeEnum.FIXED_PRICE
        )
        offer = PaymentsOffer(
            org_id=product.org_id,
            payments_config_id=product.payments_config_id,
            usergroup_id=ug.id,
            name=product.name,
            description=product.description,
            offer_type=offer_type,
            price_type=price_type,
            benefits=product.benefits,
            amount=product.amount,
            currency=product.currency,
            provider_product_id=product.provider_product_id,
            is_publicly_listed=True,
            creation_date=product.creation_date,
            update_date=product.update_date,
        )
        db_session.add(offer)
        db_session.flush()
        print(f"  Created PaymentsOffer id={offer.id}")

        # 3. Copy PaymentsCourse rows → UserGroupResource
        course_links = db_session.exec(
            select(PaymentsCourse).where(PaymentsCourse.payment_product_id == product.id)
        ).all()
        for link in course_links:
            course = db_session.exec(
                select(Course).where(Course.id == link.course_id)
            ).first()
            if not course:
                print(f"  WARNING: course id={link.course_id} not found, skipping")
                continue
            # Avoid duplicate
            existing = db_session.exec(
                select(UserGroupResource).where(
                    UserGroupResource.usergroup_id == ug.id,
                    UserGroupResource.resource_uuid == course.course_uuid,
                )
            ).first()
            if existing:
                continue
            ugr = UserGroupResource(
                usergroup_id=ug.id,
                resource_uuid=course.course_uuid,
                org_id=product.org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(ugr)
            print(f"  Linked course {course.course_uuid} to UserGroup")

        # 4. Copy PaymentsUser rows → PaymentsEnrollment
        payment_users = db_session.exec(
            select(PaymentsUser).where(PaymentsUser.payment_product_id == product.id)
        ).all()
        for pu in payment_users:
            enrollment = PaymentsEnrollment(
                offer_id=offer.id,
                user_id=pu.user_id,
                org_id=pu.org_id,
                status=_status_map(pu.status),
                provider_specific_data=pu.provider_specific_data or {},
                creation_date=pu.creation_date,
                update_date=pu.update_date,
            )
            db_session.add(enrollment)

            # If enrollment is ACTIVE or COMPLETED, also add user to UserGroup
            if pu.status in (PaymentStatusEnum.ACTIVE, PaymentStatusEnum.COMPLETED):
                from src.db.usergroup_user import UserGroupUser
                existing_member = db_session.exec(
                    select(UserGroupUser).where(
                        UserGroupUser.usergroup_id == ug.id,
                        UserGroupUser.user_id == pu.user_id,
                    )
                ).first()
                if not existing_member:
                    member = UserGroupUser(
                        usergroup_id=ug.id,
                        user_id=pu.user_id,
                        org_id=pu.org_id,
                        creation_date=str(datetime.now()),
                        update_date=str(datetime.now()),
                    )
                    db_session.add(member)

        print(f"  Migrated {len(payment_users)} payment_user rows to enrollments")

    db_session.commit()
    print("\nMigration complete.")


if __name__ == "__main__":
    config = get_learnhouse_config()
    db_url = config.database_config.database_connection_string
    engine = create_engine(db_url)

    with Session(engine) as session:
        run_migration(session)
