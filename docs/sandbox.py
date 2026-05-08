"""
Sandbox Pyodide pour tester les bots côté navigateur.

Exécuté à l'intérieur de Pyodide. Expose:
  - REFERENCE_BOTS : dict {nom: fonction} des stratégies de référence
  - validate_bot_code(code) : vérifie qu'un code utilisateur définit une fonction play() valide
  - run_test(code, opponent_name, nb_turns, noise_level, seed) : valide + joue un match, renvoie un dict
"""

import random


PAYOFF = {
    ('C', 'C'): (3, 3),
    ('C', 'D'): (0, 5),
    ('D', 'C'): (5, 0),
    ('D', 'D'): (1, 1),
}


# Bots de référence — les équipes peuvent s'entraîner contre eux.

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
    # win-stay, lose-shift : on rejoue le même coup si on a "gagné" au tour
    # précédent (les deux ont coopéré, ou on a trahi sans riposte). Sinon on
    # change.
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


# Imports interdits dans le code utilisateur (filtrés à la lecture).
FORBIDDEN_IMPORTS = {
    'os', 'sys', 'subprocess', 'socket', 'shutil', 'pathlib', 'requests',
    'urllib', 'http', 'pickle', 'marshal', 'ctypes', 'multiprocessing',
    'threading', 'asyncio',
}

FORBIDDEN_NAMES = {'eval', 'exec', '__import__', 'compile', 'open'}


def _check_forbidden(code):
    """Renvoie un message d'erreur si le code utilise des choses interdites, sinon None."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f'Erreur de syntaxe ligne {e.lineno}: {e.msg}'

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Import interdit: '{alias.name}'"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root = node.module.split('.')[0]
                if root in FORBIDDEN_IMPORTS:
                    return f"Import interdit: 'from {node.module}'"
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            return f"Utilisation interdite de '{node.id}'"
    return None


def validate_bot_code(code):
    """Vérifie qu'un code utilisateur définit une fonction play() valide.

    Renvoie un dict {ok: bool, message: str, play: callable | None}
    """
    forbidden = _check_forbidden(code)
    if forbidden:
        return {'ok': False, 'message': forbidden, 'play': None}

    namespace = {}
    try:
        exec(code, namespace)
    except SyntaxError as e:
        return {'ok': False, 'message': f'Erreur de syntaxe: {e}', 'play': None}
    except Exception as e:
        return {'ok': False, 'message': f'Erreur au chargement: {type(e).__name__}: {e}', 'play': None}

    if 'play' not in namespace:
        return {'ok': False, 'message': "Pas de fonction play() définie dans ton code.", 'play': None}
    play = namespace['play']
    if not callable(play):
        return {'ok': False, 'message': "play n'est pas une fonction.", 'play': None}

    try:
        result = play([], [])
    except Exception as e:
        return {'ok': False, 'message': f'play() a planté au tour 0: {type(e).__name__}: {e}', 'play': None}
    if result not in ('C', 'D'):
        return {'ok': False, 'message': f"play() a renvoyé {result!r} au tour 0, attendu 'C' ou 'D'.", 'play': None}

    return {'ok': True, 'message': 'Bot valide.', 'play': play}


def run_match(play_a, play_b, nb_turns=30, noise_level=0.0):
    """Joue un match entre deux bots. Renvoie un dict avec les scores et historiques."""
    hist_a, hist_b = [], []
    score_a, score_b = 0, 0
    intended_a, intended_b = [], []  # coups voulus (avant bruit)

    for turn in range(nb_turns):
        try:
            move_a = play_a(list(hist_a), list(hist_b))
        except Exception as e:
            return {'ok': False, 'error': f'Ton bot a planté au tour {turn}: {type(e).__name__}: {e}'}
        if move_a not in ('C', 'D'):
            return {'ok': False, 'error': f"Ton bot a renvoyé {move_a!r} au tour {turn}, attendu 'C' ou 'D'."}

        try:
            move_b = play_b(list(hist_b), list(hist_a))
        except Exception as e:
            return {'ok': False, 'error': f"L'adversaire a planté au tour {turn}: {type(e).__name__}: {e}"}
        if move_b not in ('C', 'D'):
            return {'ok': False, 'error': f"L'adversaire a renvoyé {move_b!r} au tour {turn}."}

        intended_a.append(move_a)
        intended_b.append(move_b)

        # Bruit : chaque coup peut être inversé en transmission.
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


def run_test(code, opponent_name, nb_turns=30, noise_level=0.0, seed=None):
    """Valide le code utilisateur puis joue un match contre un bot de référence.

    Renvoie un dict avec ok=True/False et soit les résultats, soit une erreur.
    """
    if seed is not None:
        random.seed(seed)

    validation = validate_bot_code(code)
    if not validation['ok']:
        return {'ok': False, 'error': validation['message']}

    if opponent_name not in REFERENCE_BOTS:
        return {'ok': False, 'error': f"Adversaire inconnu: '{opponent_name}'"}

    result = run_match(
        validation['play'],
        REFERENCE_BOTS[opponent_name],
        nb_turns=nb_turns,
        noise_level=noise_level,
    )
    result['opponent'] = opponent_name
    return result
