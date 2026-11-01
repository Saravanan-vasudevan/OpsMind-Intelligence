import sys, pathlib
import tree_sitter_c_sharp as tscs
from tree_sitter import Language, Parser
parser = Parser(Language(tscs.language()))
bad = 0
files = [p for root in sys.argv[1:] for p in pathlib.Path(root).rglob("*.cs") if "/obj/" not in str(p) and "/bin/" not in str(p)]
def errors(node, out):
    if node.type == "ERROR" or node.is_missing: out.append(node)
    for c in node.children: errors(c, out)
for f in sorted(files):
    tree = parser.parse(f.read_bytes())
    out = []; errors(tree.root_node, out)
    if out:
        bad += 1
        for n in out[:3]: print(f"{f}:{n.start_point[0]+1}:{n.start_point[1]+1} {'MISSING '+n.type if n.is_missing else 'ERROR'}")
print(f"{len(files)} files parsed, {bad} with syntax errors")
