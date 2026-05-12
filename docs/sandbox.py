"""
Pyodide sandbox to test user bots in the browser.

Runs inside Pyodide. Exposes:
  - REFERENCE_BOTS: dict {name: callable} of reference strategies
  - validate_bot_code(code): checks that user code defines a valid play() function
  - run_test(code, opponent_name, nb_turns, noise_level, seed): validates + plays a match,
    returns a dict with results or error.
"""

import random


PAYOFF = {
    ('C', 'C'): (3, 3),
    ('C', 'D'): (0, 5),
    ('D', 'C'): (5, 0),
    ('D', 'D'): (1, 1),
}


# Reference bots — teams can train against them.

def always_cooperate(my_h, opp_h):
    return 'C'


def always_defect(my_h, opp_h):
    return 'D'


def tit_for_tat(my_h, opp_h):
    if not opp_h:
        return 'C'
    return opp_h[-1]


def grudger(my_h, opp_h):
    if 'D' in opp_h:
        return 'D'
    return 'C'


def pavlov(my_h, opp_h):
    # win-stay, lose-shift: replay the same move if we "won" the previous round
    # (both cooperated, or we defected unopposed). Otherwise switch.
    if not my_h:
        return 'C'
    last_me = my_h[-1]
    last_opp = opp_h[-1]
    won = (last_me == 'C' and last_opp == 'C') or (last_me == 'D' and last_opp == 'C')
    if won:
        return last_me
    return 'D' if last_me == 'C' else 'C'


def generous_tit_for_tat(my_h, opp_h):
    if not opp_h:
        return 'C'
    if opp_h[-1] == 'D' and random.random() < 0.1:
        return 'C'
    return opp_h[-1]


def random_bot(my_h, opp_h):
    return random.choice(['C', 'D'])


REFERENCE_BOTS = {
    'always_cooperate': always_cooperate,
    'always_defect': always_defect,
    'tit_for_tat': tit_for_tat,
    'grudger': grudger,
    'pavlov': pavlov,
    'generous_tit_for_tat': generous_tit_for_tat,
    'random': random_bot,
}


# Imports forbidden in user code (filtered at parse time).
FORBIDDEN_IMPORTS = {
    'os', 'sys', 'subprocess', 'socket', 'shutil', 'pathlib', 'requests',
    'urllib', 'http', 'pickle', 'marshal', 'ctypes', 'multiprocessing',
    'threading', 'asyncio',
}

FORBIDDEN_NAMES = {'eval', 'exec', '__import__', 'compile', 'open'}


def _check_forbidden(code):
    """Returns an error message if the code uses forbidden things, otherwise None."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f'Syntax error on line {e.lineno}: {e.msg}'

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Forbidden import: '{alias.name}'"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root = node.module.split('.')[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Forbidden import: 'from {node.module}'"
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            return f"Forbidden use of '{node.id}'"
    return None


def validate_bot_code(code):
    """Checks that user code defines a valid play() function.

    Returns a dict {ok: bool, message: str, play: callable | None}
    """
    forbidden = _check_forbidden(code)
    if forbidden:
        return {'ok': False, 'message': forbidden, 'play': None}

    namespace = {}
    try:
        exec(code, namespace)
    except SyntaxError as e:
        return {'ok': False, 'message': f'Syntax error: {e}', 'play': None}
    except Exception as e:
        return {'ok': False, 'message': f'Load error: {type(e).__name__}: {e}', 'play': None}

    if 'play' not in namespace:
        return {'ok': False, 'message': "No play() function defined in your code.", 'play': None}
    play = namespace['play']
    if not callable(play):
        return {'ok': False, 'message': "play is not a function.", 'play': None}

    try:
        result = play([], [])
    except Exception as e:
        return {'ok': False, 'message': f'play() crashed on round 0: {type(e).__name__}: {e}', 'play': None}
    if result not in ('C', 'D'):
        return {'ok': False, 'message': f"play() returned {result!r} on round 0, expected 'C' or 'D'.", 'play': None}

    return {'ok': True, 'message': 'Bot is valid.', 'play': play}


def run_match(play_a, play_b, nb_turns=30, noise_level=0.0):
    """Plays a match between two bots. Returns a dict with scores and histories."""
    hist_a, hist_b = [], []
    score_a, score_b = 0, 0
    intended_a, intended_b = [], []  # intended moves (before noise)

    for turn in range(nb_turns):
        try:
            move_a = play_a(list(hist_a), list(hist_b))
        except Exception as e:
            return {'ok': False, 'error': f'Your bot crashed on round {turn}: {type(e).__name__}: {e}'}
        if move_a not in ('C', 'D'):
            return {'ok': False, 'error': f"Your bot returned {move_a!r} on round {turn}, expected 'C' or 'D'."}

        try:
            move_b = play_b(list(hist_b), list(hist_a))
        except Exception as e:
            return {'ok': False, 'error': f"Opponent crashed on round {turn}: {type(e).__name__}: {e}"}
        if move_b not in ('C', 'D'):
            return {'ok': False, 'error': f"Opponent returned {move_b!r} on round {turn}."}

        intended_a.append(move_a)
        intended_b.append(move_b)

        # Noise: each move may be flipped in transmission.
        if noise_level > 0:
            if random.random() < noise_level:
                move_a = 'D' if move_a == 'C' else 'C'
            if random.random() < noise_level:
                move_b = 'D' if move_b == 'C' else 'C'

        sa, sb = PAYOFF[(move_a, move_b)]
        score_a += sa
        score_b += sb
        hist_a.append(move_a)
        hist_b.append(move_b)

    return {
        'ok': True,
        'score_a': score_a,
        'score_b': score_b,
        'history_a': ''.join(hist_a),
        'history_b': ''.join(hist_b),
        'intended_a': ''.join(intended_a),
        'intended_b': ''.join(intended_b),
        'nb_turns': nb_turns,
        'noise_level': noise_level,
    }


def analyze_strategy(my_history, opp_history):
    """Heuristic analysis of the user's strategy.

    Returns a dict with:
      - profile: a string key matching one of the i18n profile entries
        (cooperative, aggressive, tit_for_tat, vengeful, forgiving, pavlov, mixed, erratic)
      - stats: dict of useful metrics (coop_rate, reactivity, forgiveness,
        retaliation, win_stay, lose_shift, opening, run_length_avg)
    """
    nb = len(my_history)
    if nb < 5:
        return {'profile': 'no_data', 'stats': {}}

    coop = my_history.count('C')
    coop_rate = coop / nb

    # Reactivity: I copied opponent's previous move
    react_hits = sum(1 for i in range(1, nb) if my_history[i] == opp_history[i - 1])
    reactivity = react_hits / max(1, nb - 1)

    # Forgiveness: I cooperate after the opponent defected
    forgive_chances = sum(1 for i in range(1, nb) if opp_history[i - 1] == 'D')
    forgive_hits = sum(1 for i in range(1, nb) if opp_history[i - 1] == 'D' and my_history[i] == 'C')
    forgiveness = forgive_hits / max(1, forgive_chances)

    # Retaliation: I defected after opponent defected
    retaliate_hits = sum(1 for i in range(1, nb) if opp_history[i - 1] == 'D' and my_history[i] == 'D')
    retaliation = retaliate_hits / max(1, forgive_chances)

    # Pavlov detection: win-stay (CC, DC) → same move; lose-shift (CD, DD) → switch
    pavlov_hits = 0
    pavlov_total = 0
    for i in range(1, nb):
        last_me = my_history[i - 1]
        last_opp = opp_history[i - 1]
        won = (last_me == 'C' and last_opp == 'C') or (last_me == 'D' and last_opp == 'C')
        expected = last_me if won else ('D' if last_me == 'C' else 'C')
        if my_history[i] == expected:
            pavlov_hits += 1
        pavlov_total += 1
    pavlov_score = pavlov_hits / max(1, pavlov_total)

    # Tit-for-tat detection: I exactly copy opponent's previous move
    tft_score = reactivity  # same metric, but we'll require high score

    # Erratic: many short runs in my sequence
    runs = 1
    for i in range(1, nb):
        if my_history[i] != my_history[i - 1]:
            runs += 1
    avg_run = nb / runs

    opening = my_history[0]

    stats = {
        'coop_rate': round(coop_rate, 3),
        'reactivity': round(reactivity, 3),
        'forgiveness': round(forgiveness, 3),
        'retaliation': round(retaliation, 3),
        'pavlov_score': round(pavlov_score, 3),
        'avg_run': round(avg_run, 2),
        'opening': opening,
    }

    # Profile classification — order matters (most specific first)
    if tft_score >= 0.85 and 0.2 <= coop_rate <= 0.8:
        profile = 'tit_for_tat'
    elif pavlov_score >= 0.85 and 0.2 <= coop_rate <= 0.8:
        profile = 'pavlov'
    elif coop_rate >= 0.85:
        profile = 'cooperative'
    elif coop_rate <= 0.2:
        profile = 'aggressive'
    elif forgive_chances >= 3 and forgiveness <= 0.15 and retaliation >= 0.6:
        profile = 'vengeful'
    elif forgive_chances >= 3 and forgiveness >= 0.55:
        profile = 'forgiving'
    elif avg_run < 1.6:
        profile = 'erratic'
    else:
        profile = 'mixed'

    return {'profile': profile, 'stats': stats}


def run_test(code, opponent_name, nb_turns=30, noise_level=0.0, seed=None):
    """Validates user code then plays a match against a reference bot.

    Returns a dict with ok=True/False and either results or an error.
    """
    if seed is not None:
        random.seed(seed)

    validation = validate_bot_code(code)
    if not validation['ok']:
        return {'ok': False, 'error': validation['message']}

    if opponent_name not in REFERENCE_BOTS:
        return {'ok': False, 'error': f"Unknown opponent: '{opponent_name}'"}

    result = run_match(
        validation['play'],
        REFERENCE_BOTS[opponent_name],
        nb_turns=nb_turns,
        noise_level=noise_level,
    )
    result['opponent'] = opponent_name
    return result


def run_tournament_match(code_a, code_b, nb_turns=30, noise_level=0.0, seed=None):
    """Validates two user bots and plays a match between them.

    Returns a dict {ok, ...}. If either bot fails to validate, the match
    is forfeited for the failing side(s) — the other team gets `nb_turns * 5`
    (max payoff) and the failing team gets 0.
    Used by the tournament runner on the admin page.
    """
    if seed is not None:
        random.seed(seed)

    va = validate_bot_code(code_a)
    vb = validate_bot_code(code_b)

    if not va['ok'] and not vb['ok']:
        return {
            'ok': True, 'forfeit': 'both',
            'score_a': 0, 'score_b': 0,
            'history_a': '', 'history_b': '',
            'error_a': va['message'], 'error_b': vb['message'],
            'nb_turns': nb_turns, 'noise_level': noise_level,
        }
    if not va['ok']:
        return {
            'ok': True, 'forfeit': 'a',
            'score_a': 0, 'score_b': nb_turns * 5,
            'history_a': '', 'history_b': 'D' * nb_turns,
            'error_a': va['message'],
            'nb_turns': nb_turns, 'noise_level': noise_level,
        }
    if not vb['ok']:
        return {
            'ok': True, 'forfeit': 'b',
            'score_a': nb_turns * 5, 'score_b': 0,
            'history_a': 'D' * nb_turns, 'history_b': '',
            'error_b': vb['message'],
            'nb_turns': nb_turns, 'noise_level': noise_level,
        }

    return run_match(va['play'], vb['play'], nb_turns=nb_turns, noise_level=noise_level)
