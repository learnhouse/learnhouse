from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser
from src.db.payments.payments_users import PaymentsUser
from src.services.orgs.orgs import rbac_check
from src.services.payments.payments_products import get_payments_product
from src.services.users.users import read_user_by_id

async def get_customers(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Check if organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Get all payment users for the organization
    statement = select(PaymentsUser).where(PaymentsUser.org_id == org_id)
    payment_users = db_session.exec(statement).all()

    customers_data = []
    
    for payment_user in payment_users:
        # Get user data
        user = await read_user_by_id(request, db_session, current_user, payment_user.user_id)
        
        # Get product data
        if org.id is None:
            raise HTTPException(status_code=400, detail="Invalid organization ID")
        product = await get_payments_product(request, org.id, payment_user.payment_product_id, current_user, db_session)

        customer_data = {
            'payment_user_id': payment_user.id,
            'user': user if user else None,
            'product': product if product else None,
            'status': payment_user.status,
            'creation_date': payment_user.creation_date,
            'update_date': payment_user.update_date
        }
        customers_data.append(customer_data)

    return customers_data