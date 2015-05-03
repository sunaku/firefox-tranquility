
    var prefs = Components.classes["@mozilla.org/preferences-service;1"]
                 .getService(Components.interfaces.nsIPrefService)
                 .getBranch("extensions.tranquility.");

    // Add system fonts to preferences
    var enumerator = Components.classes["@mozilla.org/gfx/fontenumerator;1"]
                      .getService(Components.interfaces.nsIFontEnumerator);
    var fonts = enumerator.EnumerateAllFonts({});
    var fontlist = document.getElementById("tranquility-default-font-menulist");
    var fontpopup = document.getElementById("tranquility-default-font-menupopup");
    var fontsizelist = document.getElementById("tranquility-default-fontsize-menulist");
    var fontsizepopup = document.getElementById("tranquility-default-fontsize-menupopup");
    var wikilanglist = document.getElementById("tranquility-wiki-language-menulist");
    var wikilangpopup = document.getElementById("tranquility-wiki-language-menupopup");

    for(var i=0; i < fonts.length; i++) {
        var mitem = document.createElement("menuitem");
        mitem.setAttribute("label", fonts[i]);
        mitem.setAttribute("value", fonts[i]);
        fontpopup.appendChild(mitem);
        if(prefs.getCharPref("defaultFont") == fonts[i]) {
           fontlist.selectedItem = mitem;
        }
    }

    for(var i=10; i < 65; i=i+2) {
        var mitem = document.createElement("menuitem");
        mitem.setAttribute("label", i);
        mitem.setAttribute("value", i);
        fontsizepopup.appendChild(mitem);
        if(prefs.getIntPref("defaultFontSize") == i) {
           fontsizelist.selectedItem = mitem;
        }
    }
    
    var wikiLanguages = { "English":"en",  "Simple English":"simple",
                          "العربية":"ar", "Bahasa Indonesia":"id",
                          "Bahasa Melayu":"ms", "Български":"bg", "Català":"ca", 
                          "Česky":"cs", "Dansk":"da", "Deutsch":"de", "Eesti":"et",
                          "Ελληνικά":"el", "Español":"es", "Esperanto":"eo", "Euskara":"eu",
                          "فارسی":"fa", "Français":"fr", "Galego":"gl", "한국어":"ko",
                          "עברית":"he", "Hrvatski":"hr", "Italiano":"it", "Lietuvių":"lt",
                          "Magyar":"hu", "Nederlands":"nl", "日本語":"ja", 
                          "Norsk (bokmål)‬":"no", "Norsk (nynorsk)‬":"nn",
                          "Polski":"pl", "Português":"pt", "Română":"ro", "Русский":"ru",
                          "Slovenčina":"sk", "Slovenščina":"sl", "Српски / Srpski":"sr",
                          "Srpskohrvatski / Српскохрватски":"sh", "Suomi":"fi",
                          "Svenska":"sv", "ไทย":"th", "Tiếng Việt":"vi", "Türkçe":"tr",
                          "Українська":"uk", "中文":"zh" };
    for(var lang in wikiLanguages) {
        var mitem = document.createElement("menuitem");
        mitem.setAttribute("label", lang);
        mitem.setAttribute("value", wikiLanguages[lang]);
        wikilangpopup.appendChild(mitem);
        if(prefs.getCharPref("wikiLanguage") == wikiLanguages[lang]) {
           wikilanglist.selectedItem = mitem;
        }
    }
