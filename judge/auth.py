from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

User = get_user_model()


class EmailOrUsernameModelBackend(ModelBackend):
    """
    Authentication backend that allows users to log in using either their
    username or email address.
    """
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)

        try:
            # Try to fetch the user by username or email
            user = User.objects.get(Q(username__iexact=username) | Q(email__iexact=username))
        except User.DoesNotExist:
            # Run the default password hasher once to reduce the timing
            # difference between an existing and a nonexistent user.
            User().set_password(password)
            return None
        except User.MultipleObjectsReturned:
            # If multiple users have the same email, we can't decide which one to authenticate.
            # In DMOJ, emails are usually unique, but we should handle this case.
            # We filter by username first if possible.
            user = User.objects.filter(username__iexact=username).first()
            if not user:
                # If no username match, we can't safely authenticate by email if it's not unique.
                return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
