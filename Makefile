UUID      := ddc-brightness@genexiz
SRC       := $(UUID)
DIST      := dist
ZIP       := $(DIST)/$(UUID).shell-extension.zip
EXT_DIR   := $(HOME)/.local/share/gnome-shell/extensions
TARGET    := $(EXT_DIR)/$(UUID)

.PHONY: all pack install uninstall link enable disable check clean

all: pack

## Build an installable zip (same format as extensions.gnome.org)
pack: $(ZIP)

$(ZIP): $(SRC)/extension.js $(SRC)/ddc-helper.py $(SRC)/metadata.json $(SRC)/stylesheet.css
	@mkdir -p $(DIST)
	gnome-extensions pack $(SRC) --force --out-dir=$(DIST) --extra-source=ddc-helper.py

## Install the packed zip for the current user
install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Log out and back in (Wayland), then run: make enable"

## Remove the extension for the current user
uninstall:
	-gnome-extensions disable $(UUID)
	-gnome-extensions uninstall $(UUID)
	rm -rf $(TARGET)

## Development: symlink the source folder instead of copying it
link:
	@mkdir -p $(EXT_DIR)
	rm -rf $(TARGET)
	ln -s $(CURDIR)/$(SRC) $(TARGET)
	@echo "Linked $(TARGET) -> $(CURDIR)/$(SRC)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

## Syntax checks (no GNOME session needed)
check:
	python3 -m py_compile $(SRC)/ddc-helper.py
	@rm -rf $(SRC)/__pycache__
	gjs -c "new Function(\`$$(sed -e '/^import /d' -e 's/^export default //' $(SRC)/extension.js | sed 's/[`$$\\]/\\&/g')\`)"
	python3 -c "import json; json.load(open('$(SRC)/metadata.json'))"
	@echo "All checks passed"

clean:
	rm -rf $(DIST)
