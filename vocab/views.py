import json
from datetime import datetime, timezone
from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.http import url_has_allowed_host_and_scheme

from .models import ListProgress, WordProgress


def _datetime_from_ms(value):
    if not value:
        return None
    return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)


def _api_login_required(view_func):
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': '请先登录'}, status=401)
        return view_func(request, *args, **kwargs)
    return wrapped


def auth_page(request):
    if request.user.is_authenticated:
        return redirect('index')
    return render(request, 'vocab/auth.html', {'next': request.GET.get('next', '')})


@require_http_methods(['POST'])
def login_view(request):
    username = request.POST.get('username', '').strip()
    password = request.POST.get('password', '')
    user = authenticate(request, username=username, password=password)
    if user is None:
        return render(request, 'vocab/auth.html', {
            'error': '用户名或密码错误。',
            'active_form': 'login',
            'username': username,
            'next': request.POST.get('next', ''),
        }, status=400)
    login(request, user)
    next_url = request.POST.get('next', '')
    if url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
        return redirect(next_url)
    return redirect('index')


@require_http_methods(['POST'])
def register_view(request):
    username = request.POST.get('username', '').strip()
    password = request.POST.get('password', '')
    context = {'active_form': 'register', 'username': username}
    if not username or not password:
        context['error'] = '用户名和密码不能为空。'
        return render(request, 'vocab/auth.html', context, status=400)
    try:
        User._meta.get_field('username').run_validators(username)
    except ValidationError:
        context['error'] = '用户名只能包含字母、数字和 @ . + - _。'
        return render(request, 'vocab/auth.html', context, status=400)
    if User.objects.filter(username__iexact=username).exists():
        context['error'] = '该用户名已被注册，请换一个。'
        return render(request, 'vocab/auth.html', context, status=409)
    try:
        with transaction.atomic():
            user = User.objects.create_user(username=username, password=password)
            WordProgress.objects.filter(owner__isnull=True).update(owner=user)
            ListProgress.objects.filter(owner__isnull=True).update(owner=user)
    except IntegrityError:
        context['error'] = '该用户名已被注册，请换一个。'
        return render(request, 'vocab/auth.html', context, status=409)
    login(request, user)
    return redirect('index')


@require_http_methods(['POST'])
def logout_view(request):
    logout(request)
    return redirect('auth')


@ensure_csrf_cookie
@login_required(login_url='auth')
def index(request):
    return render(request, 'vocab/index.html')


@_api_login_required
@require_http_methods(['GET', 'PUT', 'DELETE'])
def progress_collection(request):
    if request.method == 'GET':
        data = {item.word_id: item.as_client_dict() for item in WordProgress.objects.filter(owner=request.user)}
        return JsonResponse(data)
    if request.method == 'DELETE':
        WordProgress.objects.filter(owner=request.user).delete()
        return JsonResponse({'ok': True})

    payload = json.loads(request.body or '{}')
    WordProgress.objects.filter(owner=request.user).delete()
    for word_id, state in payload.items():
        WordProgress.objects.create(
            owner=request.user,
            word_id=word_id,
            seen=state.get('seen', 0),
            correct=state.get('correct', 0),
            wrong=state.get('wrong', 0),
            ease=state.get('ease', 2.5),
            due_at=_datetime_from_ms(state.get('due')),
            last_seen_at=_datetime_from_ms(state.get('last')),
        )
    return JsonResponse({'ok': True, 'count': len(payload)})


@_api_login_required
@require_http_methods(['GET', 'DELETE'])
def list_progress_collection(request):
    if request.method == 'DELETE':
        ListProgress.objects.filter(owner=request.user).delete()
        return JsonResponse({'ok': True})

    data = {str(item.list_no): item.as_client_dict() for item in ListProgress.objects.filter(owner=request.user)}
    return JsonResponse(data)


@_api_login_required
@require_http_methods(['POST'])
def complete_list(request, list_no):
    progress, _ = ListProgress.objects.get_or_create(owner=request.user, list_no=list_no)
    progress.completed_count += 1
    progress.save(update_fields=['completed_count', 'updated_at'])
    return JsonResponse({str(list_no): progress.as_client_dict()})


@_api_login_required
@require_http_methods(['PUT'])
def progress_detail(request, word_id):
    state = json.loads(request.body or '{}')
    progress, _ = WordProgress.objects.update_or_create(
        owner=request.user,
        word_id=word_id,
        defaults={
            'seen': state.get('seen', 0),
            'correct': state.get('correct', 0),
            'wrong': state.get('wrong', 0),
            'ease': state.get('ease', 2.5),
            'due_at': _datetime_from_ms(state.get('due')),
            'last_seen_at': _datetime_from_ms(state.get('last')),
        },
    )
    return JsonResponse({word_id: progress.as_client_dict()})
