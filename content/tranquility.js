/*
 *  Tranquility is a FireFox extension that makes web articles readable.
 *  Copyright (C) 2012-2015 Arun Kunchithapatham
 *
 *  This file is part of Tranquility.
 *
 *   Tranquility is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Tranquility is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with Tranquility.  If not, see <http://www.gnu.org/licenses/>.
*/

// Progress Listener implementation for Tranquility
// currently implements only onLocationChange to clear cached documents
// that are no longer needed
//
var Tranquility_ProgressListener = {
    QueryInterface: function(aIID) {
        if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
            aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
            aIID.equals(Components.interfaces.nsISupports))
            return this;
        throw Components.results.NS_NOINTERFACE;
    },

    onLocationChange: function(aProgress, aRequest, aURI) {
        Tranquility.onURLChange(aURI);
    },

    onStateChange: function(a, b, c, d) {},
    onProgressChange: function(a, b, c, d, e, f) {},
    onStatusChange: function(a, b, c, d) {},
    onSecurityChange: function(a, b, c) {}
};

var Tranquility = {

    gOrigDoc: [],
    gTranquilDoc: [],
    gOrigLinks: [],
    gNavLinks: [],
    gDOMLoaded: [],
    prefs: null,
  
    onLoad: function() {
    
        // initialization code
        Components.utils.import("resource://gre/modules/PopupNotifications.jsm");
   
        var menu = document.getElementById("contentAreaContextMenu");
        menu.addEventListener("popupshowing", Tranquility.onRightClick, false);

        // Add Progress listener for Tranquility; Implements only onLocationChange 
        // Add TabClose eventListener
        // Both of the above will be used to clear the cached documents
        // when the pages referring to them are closed
        gBrowser.addTabsProgressListener(Tranquility_ProgressListener);
        gBrowser.tabContainer.addEventListener("TabClose", Tranquility.onTabClose, false);
        
        // first run code
        // As per AMO review suggestion, using Services.prefs since 
        // Components.utils.import("resource://gre/modules/Services.jsm")
        // is imported by default
        // Moved from nsIPrefBranch2 to nsIPrefBranch in 1.1.13 as per compatibility report
        //
        this.prefs = Services.prefs.getBranch("extensions.tranquility.");
        this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch);
        this.prefs.addObserver("", this, false);

        if(this.prefs.getBoolPref("firstrun")) {
            this.prefs.setBoolPref("firstrun", false);
            var tbarbutton = document.getElementById("tranquility-toolbar-button");
            if(!tbarbutton) {
                var navbar = document.getElementById("nav-bar");
                var searchbar = document.getElementById("search-container");
                var before = navbar.firstChild;
                if(searchbar) {
                    before = searchbar.nextElementSibling;
                }
                navbar.insertItem("tranquility-toolbar-button", before, null, "false");
                navbar.setAttribute("currentset", navbar.currentSet);
                document.persist(navbar.id, "currentset");
            }
        }
      
        // Enable or disable the single/key mode based on the option value
        if(this.prefs.getBoolPref("enableSingleKeyMode"))
           document.getElementById("tranquility-single-key").setAttribute('disabled', 'false');
        else 
           document.getElementById("tranquility-single-key").setAttribute('disabled', 'true');

        this.initialized = true;
    },
    
    // Code added to cleanly support Private Browsing Mode
    // When Private Browsing is enabled, do not support "Read Later" or 
    // "Load Offline Links" pages which are stored in an IndexedDB database
    inPrivateBrowsingMode: function() {
        try {
            // Firefox 20+
            Components.utils.import("resource://gre/modules/PrivateBrowsingUtils.jsm");
            return PrivateBrowsingUtils.isWindowPrivate(window); 
        } catch(e) {
            // pre Firefox 20
            try {
                var pbs = Components.classes["@mozilla.org/privatebrowsing;1"].
                            getService(Components.interfaces.nsIPrivateBrowsingService);
                return pbs.privateBrowsingEnabled;
            } catch(e) {
                // pre FireFox 3.5? And does not support private browsing?
                // HOW?!! This addon does not support versions prior to Firefox 16!
                Components.utils.reportError(e);
                return false;
            }
        }
    },

    onLinkRightClickContextMenu: function(url) {

        var strBundle = document.getElementById("tranquility-string-bundle");
        var notifyString = strBundle.getString('waitingForLoadNotification');
        var newTabBrowser1 = gBrowser.getBrowserForTab(gBrowser.addTab(url));
        var lnotification = PopupNotifications.show(newTabBrowser1,
                                                    "tranquility_notify_doc_loading",
                                                    notifyString,
                                                    null, /* anchor ID */
                                                    null, /* main action */
                                                    null, /* secondary actions */
                                                    { /* options */
                                                    persistWhileVisible: true,
                                                    timeout: Date.now + 60000
                                                    }
                                                );

        var linkRightClickListener = function(e) { 
            if((e.originalTarget.nodeName == '#document') &&
               (e.originalTarget.defaultView.location.href == newTabBrowser1.currentURI.spec)) {
                Tranquility.gDOMLoaded[newTabBrowser1.currentURI.spec] = true;
                Tranquility.onToolBarOrKeyboard(newTabBrowser1, null);
                newTabBrowser1.removeEventListener("DOMContentLoaded", linkRightClickListener, true);
                lnotification.remove();
            }
        };
 
        newTabBrowser1.addEventListener("DOMContentLoaded", linkRightClickListener, true);
    },

    onSelectionRightClickContextMenu: function(newTabBrowser, source, dictName) {

        if(dictName == "annotation") {
            Tranquility.addAnnotation(newTabBrowser);
        }
        else {
            var contentDoc = newTabBrowser.contentDocument;
            var selText = contentDoc.getSelection().toString().trim();
            selText = selText.replace(/\s{2,}/g, ' '); // remove multiple whitespaces
            selText = selText.replace(/' '/g, '_');    // replace a space with the _ sign to build query url
            selText = encodeURIComponent(selText);     // encode the selection string before constructing the query

            var langPref = Tranquility.prefs.getCharPref('wikiLanguage');
            var url; 
            if(dictName == "dictionary")
                url = "http://" + langPref + ".wiktionary.org/wiki/" + selText;
            if(dictName == "wikipedia")
                url = "http://" + langPref + ".wikipedia.org/wiki/" + selText;

            Tranquility.createDictionaryElements(contentDoc); 

            var target = contentDoc.getElementById('tranquility_dictionary');
            var masker = contentDoc.getElementById('tranquility_masker');

            // If keyboard shortcut is used; toggle and exit if hiding the dictionary view
            // else, continue and update the iframe source
            if(source == "keyboard") {
                Tranquility.toggleDictionaryView(contentDoc);
                if(target.style.visibility == 'hidden')
                return;
            }

            if(selText.length < 1)
                return;

            target.setAttribute('src', url);
            target.style.visibility = 'visible';
            masker.style.visibility = 'visible';
        }
    },

    onToolBarOrKeyboard: function(newTabBrowser, mode) {

        var thisURL = newTabBrowser.currentURI.spec;
        var contentDoc = newTabBrowser.contentDocument;

        // If tranquility has already run, and there is a dictionary iframe, that is visible
        // overload the toolbar button or Ctrl+Alt+T to hide the dictionary iframe
        if(contentDoc.getElementById('tranquility_dictionary') &&
          (contentDoc.getElementById('tranquility_dictionary').style.visibility == 'visible')) {
            contentDoc.getElementById('tranquility_dictionary').style.visibility = 'hidden';
            contentDoc.getElementById('tranquility_masker').style.visibility = 'hidden';
            return;
        }

        // If tranquility has already run, toggle to the original web page
        if(contentDoc.getElementById('tranquility_container')) {
            try {
                var odoc = Tranquility.gOrigDoc[thisURL].cloneNode(true);
                contentDoc.replaceChild(odoc.documentElement, contentDoc.documentElement );
                return;
            }
            catch(err) {
                // Not sure why the restore failed; reload the original document and return
                newTabBrowser.reload();
                return;
            }
        } 
        else if(Tranquility.gTranquilDoc[thisURL] != undefined) {
            try {
                var tdoc = Tranquility.gTranquilDoc[thisURL].cloneNode(true);
                Tranquility.addBackEventListeners(tdoc);
                contentDoc.replaceChild(tdoc.documentElement, contentDoc.documentElement );
                Tranquility.hideMenuDiv(contentDoc);
                return;
            }
            catch(err) {
                // Not sure why the restore failed; continue and reprocess the document
            }
        }
        else {
            // Do nothing; continue
        }

        // If direct call vs. from right click or tranquil browsing mode, initialize variable
        if(Tranquility.gDOMLoaded[thisURL] == undefined) 
            Tranquility.gDOMLoaded[thisURL] = false;

        // Processing before complete load results in unpredictable results
        // when toggling between the orignal and tranquil document views
        //
        // Ideally we want to process the web page only when loading is complete
        // However, many webpages load a lot of junk; so for now, we will not wait
        // for contentDoc.readyState == "complete"; but process even if we reach
        // contentDoc.readyState == "interactive"; 
        // this also improves the user experience (reduced wait times)
        var strBundle = document.getElementById("tranquility-string-bundle");
        var notifyString = strBundle.getString('waitingForLoadNotification');
        var lnotification = PopupNotifications.show(newTabBrowser,
                                                  "tranquility_notify_doc_loading",
                                                  notifyString,
                                                  null, /* anchor ID */
                                                  null, /* main action */
                                                  null, /* secondary actions */
                                                  { /* options */
                                                   persistWhileVisible: true,
                                                   timeout: Date.now + 60000
                                                  }
                                                 );

        // If document has loaded sufficiently, process at once
        if((contentDoc.readyState == "interactive") || (contentDoc.readyState == "complete")) {
            Tranquility.processToolBarOrKeyBoard(newTabBrowser);
            lnotification.remove();
        }
        // else, wait for DOMContentLoaded and then process
        else {
            var domLoadedListener = function(e) { 
                if((e.originalTarget.nodeName == '#document') &&
                   (e.originalTarget.defaultView.location.href == thisURL)) {
                    // Backup the original innerHTML of the page
                    // Required in case the XMLHTTPRequest for print/single-page view fails
                    Tranquility.gDOMLoaded[thisURL] = true;
                    Tranquility.processToolBarOrKeyBoard(newTabBrowser);
                    newTabBrowser.removeEventListener("DOMContentLoaded", domLoadedListener, true);
                    lnotification.remove();
                }
            }
        };
        newTabBrowser.addEventListener("DOMContentLoaded", domLoadedListener, true);
    },

    processToolBarOrKeyBoard: function(newTabBrowser) {

        var thisURL = newTabBrowser.currentURI.spec;
        var contentDoc = newTabBrowser.contentDocument;
     
        // Backup the original innerHTML of the page
        // Required in case the XMLHTTPRequest for print/single-page view fails
        newTabBrowser.stop();
        if(Tranquility.gOrigDoc[thisURL] == undefined) {
            Tranquility.gOrigDoc[thisURL] = contentDoc.cloneNode(true);
        }

        // Check to see if there are "Print/Single Page" views we can use as a starting point
        // Only the first page is modified for multi-page doc. that does not have above links 
        var found = Tranquility.checkAlternateLink(newTabBrowser);

        // If no print/single-page view is found, then process the regular document
        if(!found) {
            Tranquility.processDocument(newTabBrowser, 'NON-PRINT');
        }
    },

    processDocument: function(newTabBrowser, mode) {

        var thisURL = newTabBrowser.currentURI.spec;
        var contentDoc = newTabBrowser.contentDocument;
        var continueProcessing = true;
        
        // Remove unnecessary whitespaces and comments
        Tranquility.removeWhiteSpaceComments(contentDoc);
 
        // Cleanup the head and unnecessary tags
        var delTags = ["STYLE", "LINK", "META", "SCRIPT", "NOSCRIPT", "IFRAME", 
                       "SELECT", "DD", "INPUT", "TEXTAREA", "HEADER"]; 
        for(var i=0; i<delTags.length; i++) {
            Tranquility.removeTag(contentDoc, delTags[i]);
        }
        // Reformat the header and use custom css
        Tranquility.reformatHeader(contentDoc);

        // Delete any hidden images (these are typically spacers)
        // Also, delete any content that has display = 'none' or visibility == 'hidden'
        // This was being done only for spacer images, but seems like a meaningful thing
        // to do for all elements, given that all scripts are also deleted in the Tranquility view
        var hiddenTags = ["DIV", "P", "IMG"];
        for(var i=0; i < hiddenTags.length; i++) {
            Tranquility.deleteHiddenElements(contentDoc, hiddenTags[i]);
        }
        
        // Processing for ads related DIV's; several websites seem to use LI elements
        // within the ads DIV's, or for navigation links which are not required in the 
        // Tranquility view.  In this section, we try to delete DIV's that have at least 
        // x% of the DIV content within LI tags
        var pruneAdsTagList = ["UL", "DIV", "ARTICLE", "SECTION"];
        var totalSize = Tranquility.computeSize(contentDoc.documentElement);
        for(var p=0; p < pruneAdsTagList.length; p++) {
            Tranquility.pruneAdsTag(contentDoc, thisURL, pruneAdsTagList[p], 0.7, totalSize);
        }
    
        // Cleanup select tags that have content length smaller than minSize 
        // This helps clean up a number of junk DIV's before we get to real content
        // Can be made a parameter in later versions
        // First run with minSize ZERO
        // Removed TD and DD for now
        var pruneTagList = ["LI", "DIV", "OL", "UL", "FORM", "TABLE", "ARTICLE", "SECTION", "SPAN", "P"];
        var minSize = 0;
        totalSize = Tranquility.computeSize(contentDoc.documentElement);
        for(var p=0; p < pruneTagList.length; p++) {
            Tranquility.pruneTag(contentDoc, pruneTagList[p], 0.0, minSize, totalSize);
        } 
        // Next run with minsize 200 (for a reduced subset of the tags)
        // Removed TD, TABLE, and DD for now
        pruneTagList = ["FORM", "DIV", "ARTICLE", "SECTION"];
        minSize = 200;
        totalSize = Tranquility.computeSize(contentDoc.documentElement);
        for(var p=0; p < pruneTagList.length; p++) {
            Tranquility.pruneTag(contentDoc, pruneTagList[p], 0.0, minSize, totalSize);
        } 
  
        // Second pass
        // Remove any elements that have zero length textContent
        pruneTagList = ["LI", "DIV", "OL", "UL", "FORM", "TABLE", "ARTICLE", "SECTION", "SPAN", "P"];
        minSize = 0;
        totalSize = Tranquility.computeSize(contentDoc.documentElement);
        for(var p=0; p < pruneTagList.length; p++) {
            Tranquility.pruneTag(contentDoc, pruneTagList[p], 0.0, minSize, totalSize);
        } 
        
        if(Tranquility.prefs.getCharPref('pruningStrategy') == "Aggressive") { 
            // Heuristic to try and handle blog style pages 
            // where no div has a substantial % of content
            // try only div's to start out
            var max_pctg = 0;
            var elem_count = 0;
            var avg_pctg = 0;
            var statspruneTagList = ["DIV", "ARTICLE", "SECTION"];
            totalSize = Tranquility.computeSize(contentDoc.documentElement);
            for(var p=0; p < statspruneTagList.length; p++) {
                var elems = contentDoc.getElementsByTagName(statspruneTagList[p]);
                for(var el=0; el < elems.length; el++) {
                    var tElem = elems[el];
                    var cLength = Tranquility.computeSize(tElem);
                    var pctg = cLength/totalSize;
                    avg_pctg += pctg;
                    elem_count++;
                    if(pctg > max_pctg) { max_pctg = pctg; }
                }
            } 
      
            elem_count == 0 ? avg_pctg = 0.1 : avg_pctg /= elem_count;
            // Cleanup the div tags; loop for better cleanup
            for(var p=0; p < pruneTagList.length; p++) {
                for(var i=1; i<3; i++) {
                    var incPctg = i*avg_pctg/4;
                    totalSize = Tranquility.computeSize(contentDoc.documentElement);
                    Tranquility.pruneTag(contentDoc, pruneTagList[p], incPctg, minSize, totalSize);
                }
            } 
        }
      
        // Try to remove unnecessary nested DIV's
        // They mess up the padding and margins; use only in moderate pruning
        // They mess up the padding and margins; use only in moderate pruning
        // if the threshold is < 0.99999
        for(var i=0; i < 5; i++) {
            Tranquility.replaceParent(contentDoc, "DIV",  0.99999);
            Tranquility.replaceParent(contentDoc, "SPAN", 0.99999);
        }
        if((Tranquility.prefs.getCharPref('pruningStrategy') == "Moderate") ||
           (Tranquility.prefs.getCharPref('pruningStrategy') == "Aggressive")) {
            Tranquility.replaceParent(contentDoc, "DIV", 0.9);
            Tranquility.replaceParent(contentDoc, "SPAN", 0.9);
        }

        // At his time, most of the cleanup has happened; check the size of the document
        // If it is below a certain absolute threshold, then maybe Tranquility did not
        // work as well, or the web page is not a suitable candidate.  Revert to the original 
        // document in this case.
        var finalSize = Tranquility.computeSize(contentDoc.documentElement);
        if(finalSize < 1000) {
            // If the print mode failed to find sufficient content, return false
            // Let Traquility try to process the original view
            // The reason for this is that some websites require a login for the PRINT
            // or Single Page view; or they try to launch the Print window
            //
            if(mode == "PRINT") {
                return false;
            }
            continueProcessing = false;
            var strBundle = document.getElementById("tranquility-string-bundle");
            var notifyString = strBundle.getString('insufficientContentNotification');
            var fnotification = PopupNotifications.show(newTabBrowser,
                                                        "tranquility_notify_doc_loading",
                                                        notifyString,
                                                        null, /* anchor ID */
                                                        /* main action */
                                                        {
                                                            label: "Process Anyway!",
                                                            accessKey: "C",
                                                            callback: function() {
                                                                continueProcessing = true;                               
                                                            }
                                                        },
                                                        null, /* secondary actions */
                                                        { /* options */
                                                            persistWhileVisible: true,
                                                            timeout: Date.now + 5000
                                                        }
                                                    );

            setTimeout(function () { 
                fnotification.remove(); 
                if(!continueProcessing) {
                    var odoc = Tranquility.gOrigDoc[thisURL].cloneNode(true);
                    contentDoc.replaceChild(odoc.documentElement, contentDoc.documentElement );
                    newTabBrowser.reload();
                    delete Tranquility.gOrigDoc[thisURL];
                    delete Tranquility.gTranquilDoc[thisURL];
                    delete Tranquility.gOrigLinks[thisURL];
                    delete Tranquility.gNavLinks[thisURL];
                    delete Tranquility.gDOMLoaded[thisURL];
                }
            }, 5000);
        }
          

        // Format the tags in a nice readable font/style using custom css loaded in header
        var reformatTagList = ["UL", "OL", "LI", "DIV", "SPAN", "P", "FONT", "BODY", "H1",
                               "PRE", "TABLE", "ARTICLE", "SECTION"];
        for(var r=0; r < reformatTagList.length; r++) {
            Tranquility.reformatTag(contentDoc, reformatTagList[r]);
        }

        // Add the "Menu Items" to the top of the page
        var menu_div = contentDoc.createElement("DIV");
        menu_div.setAttribute('class', 'tranquility_menu');
        menu_div.setAttribute('id', 'tranquility_menu');
        menu_div.setAttribute('align', 'center');
        //contentDoc.body.appendChild(menu_div);

        // Finally, beautify with two container DIV's to center align the content
        var cdiv = contentDoc.createElement("DIV");
        cdiv.setAttribute('class', 'tranquility_container');
        cdiv.setAttribute('id', 'tranquility_container');
        cdiv.setAttribute('align', 'center');
        var cdiv_inner = contentDoc.createElement("DIV");
        cdiv_inner.setAttribute('class', 'tranquility_innercontainer');
        cdiv_inner.setAttribute('id', 'tranquility_innercontainer');
        cdiv.appendChild(menu_div);
        cdiv.appendChild(cdiv_inner);
        contentDoc.body.appendChild(cdiv);

        // Add the masking div for effects
        var mdiv = contentDoc.createElement("DIV");
        mdiv.setAttribute('class', 'tranquility_masker');
        mdiv.setAttribute('id', 'tranquility_masker');
        contentDoc.body.appendChild(mdiv);

        // Add event listener to support continuous tranquility mode
        contentDoc.body.addEventListener("click", Tranquility.handleClickEvent, false);

        // Move the other divs into cdiv
        // Code modified from version 1.1.12 to take care of a corner case where the 
        // tranquility version had all <p> elements in reverse order
        var bchildren = contentDoc.body.childNodes;
        for(var i=0; i<bchildren.length; i++) {
            if((bchildren[i].id !== 'tranquility_container') && 
               (bchildren[i].id !== 'tranquility_innercontainer')) {
                cdiv_inner.appendChild(bchildren[i]);
                // decrement count since we have moved element i from the body to cdiv_inner
                // otherwise, we will only add alternate elements
                i--; 
            }
        }
                
        // Add the navigation links div into the tranquility_innercontainer
        // Do this only if we are processing a NON-PRINT mode; otherwise, we
        // very likely have the entire document already loaded
        //
        if((mode == "NON-PRINT") && (Tranquility.computeSize(Tranquility.gNavLinks[thisURL]) > 0)) {
            var p_elem = contentDoc.createElement("p");
            cdiv_inner.insertBefore(p_elem.cloneNode(true), cdiv_inner.firstChild);
            cdiv_inner.appendChild(p_elem.cloneNode(true));
            var bot_nav_links_div = Tranquility.gNavLinks[thisURL].cloneNode(true);
            bot_nav_links_div.setAttribute('id', 'tranquility_nav_links_bot');
            cdiv_inner.appendChild(bot_nav_links_div);
        }

        var strBundle = document.getElementById("tranquility-string-bundle");
        
        // Provide "more links" functionality
        //
        var links_button_div = contentDoc.createElement('div');
        links_button_div.setAttribute('class', 'tranquility_more_links_btn');
        links_button_div.setAttribute('id', 'tranquility_more_links_btn');
        links_button_div.textContent = strBundle.getString('morelinks');
        links_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
        //contentDoc.body.appendChild(links_button_div);
        menu_div.appendChild(links_button_div);

        // Remove links from the links_div that are already a part of the main document
        // This will prevent duplication of links and remove links that are out of
        // context as well as comment style links from repeating in the "More Links" div
        //
        Tranquility.removeDuplicateAndBadLinks(contentDoc, thisURL);

        // Append the links div
        var links_div = Tranquility.gOrigLinks[thisURL].cloneNode(true);
        links_div.style.visibility = 'hidden';
        contentDoc.body.appendChild(links_div);

        // Allow saving offline content (add "Read Later" button)
        //
        var readlater_button_div = contentDoc.createElement('div');
        readlater_button_div.setAttribute('class', 'tranquility_read_later_btn');
        readlater_button_div.setAttribute('id', 'tranquility_read_later_btn');
        readlater_button_div.textContent = strBundle.getString('readlater');
        readlater_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
        //contentDoc.body.appendChild(readlater_button_div);
        menu_div.appendChild(readlater_button_div);

        // Provide "Offline links" functionality
        //
        var offline_button_div = contentDoc.createElement('div');
        offline_button_div.setAttribute('class', 'tranquility_offline_links_btn');
        offline_button_div.setAttribute('id', 'tranquility_offline_links_btn');
        offline_button_div.textContent = strBundle.getString('offlinelinks');
        offline_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
        //contentDoc.body.appendChild(offline_button_div);
        menu_div.appendChild(offline_button_div);

        var offline_links_div = contentDoc.createElement('div');
        offline_links_div.setAttribute('class', 'tranquility_offline_links');
        offline_links_div.setAttribute('id', 'tranquility_offline_links');
        offline_links_div.style.visibility = 'hidden';
        contentDoc.body.appendChild(offline_links_div);
      
        // Provide "View Notes" functionality
        //
        var viewnotes_button_div = contentDoc.createElement('div');
        viewnotes_button_div.setAttribute('class', 'tranquility_viewnotes_btn');
        viewnotes_button_div.setAttribute('id', 'tranquility_viewnotes_btn');
        viewnotes_button_div.textContent = strBundle.getString('viewnotes');
        viewnotes_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
        menu_div.appendChild(viewnotes_button_div);

        // And setTimeOut to hide the menu_div
        setTimeout(function() {
            Tranquility.hideMenuDiv(contentDoc);
        }, 1000);
        
        // Apply background image preference
        if(this.prefs.getBoolPref("useBackgroundImage")) {
            contentDoc.body.setAttribute('class', 'tranquility');
        }
        else {
            contentDoc.body.setAttribute('class', 'tranquility-no-image');
        }  

        //Apply backgroundColor preference
        var elems = contentDoc.documentElement.getElementsByTagName("*");
        for(var i=0; i < elems.length; i++) {
            if((elems[i].getAttribute('class')) && 
               (elems[i].getAttribute('class') != 'tranquility_links') && 
               (elems[i].getAttribute('class') != 'tranquility_masker') && 
               (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                if(this.prefs.getBoolPref("useDefaultBackgroundColor")) {
                    elems[i].style.backgroundColor = "#FDFDFD";
                }
                else {
                    elems[i].style.backgroundColor = this.prefs.getCharPref("backgroundColor");
                }
            }
        }   
      
        Tranquility.applyFontPreferences(contentDoc);
        
        // Apply fontColor preference
        var elems = contentDoc.documentElement.getElementsByTagName("*");
        for(var i=0; i < elems.length; i++) {
            if((elems[i].getAttribute('class')) && 
               (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                if(this.prefs.getBoolPref("useDefaultFontColor")) {
                    elems[i].style.color = "#000000";
                }
                else {
                    elems[i].style.color = this.prefs.getCharPref("fontColor");
                }
            }
        }   

        // Apply linkColor preference
        var elems = contentDoc.documentElement.getElementsByTagName("a");
        for(var i=0; i < elems.length; i++) {
            if(this.prefs.getBoolPref("useDefaultLinkColor")) {
                elems[i].style.color = "#0000FF";
            }
            else {
                elems[i].style.color = this.prefs.getCharPref("linkColor");
            }
        }   

        // Update the width based on the preference setting
        // Do this for the images also
        cdiv.style.width = this.prefs.getIntPref("defaultWidthPctg") + "%"; 
        menu_div.style.width = this.prefs.getIntPref("defaultWidthPctg") + "%"; 
        Tranquility.resizeImages(contentDoc);

        // Apply text justification
        var elems = contentDoc.documentElement.getElementsByTagName("*");
        for(var i=0; i < elems.length; i++) {
            if((elems[i].getAttribute('class')) && 
               (elems[i].getAttribute('class').substr(0,11) === 'tranquility') &&
               (elems[i].getAttribute('class') !== 'tranquility_links') &&
               (elems[i].getAttribute('class') !== 'tranquility_nav_links') &&
               (elems[i].getAttribute('class') !== 'tranquility_more_links_btn') &&
               (elems[i].getAttribute('class') !== 'tranquility_offline_links_btn') &&
               (elems[i].getAttribute('class') !== 'tranquility_viewnotes_btn') &&
               (elems[i].getAttribute('class') !== 'tranquility_read_later_btn')) {
                elems[i].style.textAlign = this.prefs.getCharPref("defaultAlign");
            }
        }   

        // Apply line height preferences
        var elems = contentDoc.documentElement.getElementsByTagName("*");
        for(var i=0; i < elems.length; i++) {
            if((elems[i].getAttribute('class')) && 
               (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                elems[i].style.lineHeight = this.prefs.getIntPref("defaultLineHeightPctg") + "%";
            }
        }   
      
        // Remove target attribute from all anchor elements when TranquilBrowsingMode is enabled
        // this will enable opening the link in the same browser tab
        //
        if(this.prefs.getBoolPref("tranquilBrowsingMode")) {
            Tranquility.removeAnchorAttributes(contentDoc);
        }

        // Backup the Tranquil document
        if(Tranquility.gTranquilDoc[thisURL]  == undefined) {
            var clonedTranquilDoc = contentDoc.cloneNode(true);
            Tranquility.addBackEventListeners(clonedTranquilDoc);
            Tranquility.gTranquilDoc[thisURL] = clonedTranquilDoc;
        }

        // Successfully completed processing; return true
        return true;
    },

    checkAlternateLink: function(newTabBrowser) {
    
        var contentDoc = newTabBrowser.contentDocument;
 
        // Search for 'Single Page' links and load them in current window
        // Helps in simplifying the processing as well as in handling multi-page document

        var strBundle = document.getElementById("tranquility-string-bundle");
        var altString = strBundle.getString('singlePageString').split(",");
        var navString = strBundle.getString('navigationString').split(",");
        var navRegExp = /^\d+$/;
        
        var altURL;
        var altLink;
        var found = 0;

        var altlinks = contentDoc.getElementsByTagName('A');
 
        // Insert all links into a temporary div for later use 
        var links_div = contentDoc.createElement('div');
        links_div.setAttribute('class', 'tranquility_links');
        links_div.setAttribute('id', 'tranquility_links');
        var nav_links_div = contentDoc.createElement('div');
        nav_links_div.setAttribute('class', 'tranquility_nav_links');
        var spacerString = "  ";
        var sp_elem = contentDoc.createTextNode(spacerString);

        for(var i=0; i < altlinks.length; i++) {
            var altLinkClone = altlinks[i].cloneNode(true);
            Tranquility.removeWhiteSpaceComments(altLinkClone);
            //Collect any links that can be added to the "More Links" section
            if(altLinkClone.textContent.length >= 20) {
                var p_elem = contentDoc.createElement('p');
                p_elem.setAttribute('class', 'tranquility_links');
                p_elem.appendChild(altLinkClone.cloneNode(true));
                links_div.appendChild(p_elem.cloneNode(true));
            }
            // Collect any link that might be used for navigation in a multipage document
            var navstr = altLinkClone.textContent.replace(/\s/g, '');
            if(navstr && ((navString.indexOf(navstr.toUpperCase()) >= 0) || 
                          (navstr.search(navRegExp) != -1)) &&
              (!altLinkClone.getAttribute('onclick')) && 
              (altLinkClone.href) &&
              (altLinkClone.href != "#") &&
              (altLinkClone.href != (newTabBrowser.currentURI.spec + "#")) &&
              (altLinkClone.href.substr(0,10) !== "javascript")) {
                nav_links_div.appendChild(altLinkClone.cloneNode(true));
                nav_links_div.appendChild(sp_elem.cloneNode(true));
            } 
        }
        Tranquility.gOrigLinks[newTabBrowser.currentURI.spec] = links_div.cloneNode(true);
        Tranquility.gNavLinks[newTabBrowser.currentURI.spec] = nav_links_div.cloneNode(true);
        Tranquility.cleanupNavLinks(newTabBrowser.currentURI.spec);

        // Continue with logic to find print/link
        loop_tags:
        for(var j=0; j < altString.length; j++) {
            loop_links:
            for(var i=0; i < altlinks.length; i++) {
                var str = altlinks[i].textContent.replace(/\s/g, '');
                // Link exists; matches the possible values; is not javascript based (rather a direct href)
                if(str && ((str.toUpperCase() === altString[j]))  && 
                           (!altlinks[i].getAttribute('onclick')) && 
                           (altlinks[i].href) &&
                           (altlinks[i].href != "#") &&
                           (altlinks[i].href.substr(0,10) !== "javascript")) {
                    altURL = altlinks[i].href;
                    found = 1;
                    break loop_tags;
                }
            }
        }
        if(found) {
            Tranquility.processXMLHTTPRequest(newTabBrowser, altURL, Tranquility.processAlternateLink);
        }
        return found;
    },

    processAlternateLink: function(newTabBrowser, cdoc) {

        var target = newTabBrowser.contentDocument.body;
        while (target.hasChildNodes()) {
            target.removeChild(target.lastChild);
        }

        // Moved from nsIScriptableUnescapeHTML to nSIParserUtils as per compatibility issues in 1.1.13
        var fragment = Components.classes["@mozilla.org/parserutils;1"]
                .getService(Components.interfaces.nsIParserUtils)
                .parseFragment(cdoc, 0, false, null, target);
            
        target.appendChild(fragment);   
        var success = Tranquility.processDocument(newTabBrowser, 'PRINT');
        // If the print mode failed to find sufficient content, return false
        // Let Traquility try to process the original view
        // The reason for this is that some websites require a login for the PRINT
        // or Single Page view; or they try to launch the Print window
        //
        if(!success)  {
            // Restore the original contentDocument and then reprocess
            var odoc = Tranquility.gOrigDoc[newTabBrowser.currentURI.spec].cloneNode(true);
            newTabBrowser.contentDocument.replaceChild(odoc.documentElement, newTabBrowser.contentDocument.documentElement );
            Tranquility.processDocument(newTabBrowser, 'NON-PRINT');
        }
    },

    createDictionaryElements: function(contentDoc) {

        var target = contentDoc.getElementById('tranquility_dictionary');
        if(target != undefined) {
            // Nothing to do; skip to resize code
        }
        else {
            // Create the dictionary iframe
            target = contentDoc.createElement('iframe');
            target.setAttribute('class', 'tranquility_dictionary');
            target.setAttribute('id', 'tranquility_dictionary');
            target.setAttribute('align', 'right');
            target.style.visibility = 'hidden';
        
            // Create an event listener to capture mouse click on the iframe (to hide if required)
            target.addEventListener("click", Tranquility.handleClickEvent, false);

            contentDoc.body.appendChild(target); 
        }

        // Update the width setting if it has changed
        var dict_width = this.prefs.getIntPref("defaultWidthPctg"); 
        var delta = (100 - dict_width)/2;
        var target_width = Math.round(dict_width + delta);
        target.style.width = target_width + "%";
        target.style.left = Math.round(delta/2) + "%";
    },


    handleClickEvent: function(event) {

        var newTabBrowser = gBrowser.getBrowserForTab(gBrowser.selectedTab);
        var contentDoc = newTabBrowser.contentDocument;
        var urlStr = Tranquility.getAnchorNode(event.target);

        // Process clicking on the "Read Later" button
        if(event.target.id == 'tranquility_read_later_btn') {
            // Check to ensure that we are not in private browsing mode
            if (Tranquility.inPrivateBrowsingMode()) {
                alert("'Read Later' functionality is not supported in Private Browsing Mode");
                event.stopPropagation();
            }
            else {
                // Open the indexedDB and add link and content to the db for offline reading
                var thisURL = newTabBrowser.currentURI.spec;
                Tranquility.saveContentOffline(thisURL);
                event.stopPropagation();
            }
        }
        // Process clicking on the "Offline Links" button
        else if(event.target.id == 'tranquility_offline_links_btn') {
            if (Tranquility.inPrivateBrowsingMode()) {
                alert("'Read Later' functionality is not supported in Private Browsing Mode");
                event.stopPropagation();
            }
            else {
                var target = contentDoc.getElementById('tranquility_offline_links');
                var masker = contentDoc.getElementById('tranquility_masker');
                if(target != undefined) {
                    if(target.style.visibility == 'hidden') {
                        target.style.visibility = 'visible';
                        masker.style.visibility = 'visible';
                        event.stopPropagation();
                        Tranquility.displayOfflineFiles();
                        return;
                    }
                    if(target.style.visibility == 'visible') {
                        target.style.visibility = 'hidden';
                        masker.style.visibility = 'hidden';
                    }
                }
                event.stopPropagation();
            }
        } 
        // Process clicking on the "More Links" button
        else if(event.target.id == 'tranquility_more_links_btn') {
            var target = contentDoc.getElementById('tranquility_links');
            var masker = contentDoc.getElementById('tranquility_masker');
            if(target != undefined) {
                if(target.style.visibility == 'hidden') {
                    target.style.visibility = 'visible';
                    masker.style.visibility = 'visible';
                    event.stopPropagation();
                    return;
                }
                if(target.style.visibility == 'visible') {
                    target.style.visibility = 'hidden';
                    masker.style.visibility = 'hidden';
                }
            }
            event.stopPropagation();
        }
        // Process clicking on the "View Notes" button
        else if(event.target.id == 'tranquility_viewnotes_btn') {
            var view_notes_div = Tranquility.viewAnnotationNotes(contentDoc, 
                                                                Tranquility.prefs.getIntPref("defaultWidthPctg"));
            var masker = contentDoc.getElementById('tranquility_masker');
            
            view_notes_div.style.visibility = 'visible';
            masker.style.visibility = 'visible';
            event.stopPropagation();
        } 
        // if clicked on an annotation, toggle the visibility of the annotation note
        else if(event.target.className == 'tranquility_annotation_selection') {
            var orig_note = event.target.nextSibling;
            var notep = orig_note.cloneNode(true);
            // Set the user data flag on the original note; 
            //this is used to update a note that is edited.
            orig_note.setAttribute('data-active-note', 'true');
            var note_div = Tranquility.createAnnotationNote(contentDoc, 
                                                            notep,
                                                            Tranquility.prefs.getIntPref("defaultWidthPctg"),
                                                            event.pageY);
            var masker = contentDoc.getElementById('tranquility_masker');

            note_div.style.visibility = 'visible';
            note_div.contentEditable = 'true';
            masker.style.visibility = 'visible';
            event.stopPropagation();
        }
        // if clicked on an annotation, do nothing; clicking outside should delete annotation
        // if clicked on aggregated annotations view , do nothing; clicking outside should delete view
        else if(event.target.className == 'tranquility_annotation_note' ||
                event.target.className == 'tranquility_view_notes') {
            event.stopPropagation();
            if(event.target.className == 'tranquility_annotation_note')
                event.target.setAttribute('contentEditable', 'true');
            event.target.focus();
        }
        // If clicked on the "expand menu div" button, then expand the menu div
        else if(event.target.id == 'tranquility_expand_menu_btn') {
            Tranquility.showMenuDiv(contentDoc);
        }
        // if clicked inside the iframe, then don't hide it; stop bubbling back to body
        else if(event.target.id == 'tranquility_dictionary')  {
            Tranquility.hideLinksDiv(contentDoc);  
            Tranquility.hideOffineLinksDiv(contentDoc);  
            event.stopPropagation();
        }
        else if((urlStr != undefined) && (event.target.className == 'tranquility_offline_link')) {
            event.preventDefault();
            event.stopPropagation();
            Tranquility.loadDocFromDB(urlStr);
        }
        else if((urlStr != undefined) && (event.target.className == 'tranquility_delete_offline_link')) {
            event.preventDefault();
            event.stopPropagation();
            Tranquility.delDocFromDB(urlStr);
        }
        else if((urlStr != undefined) && Tranquility.prefs.getBoolPref("tranquilBrowsingMode"))  {
            var url = urlStr;
            // If in the Tranquil Browsing mode, we do not want to process document references
            // on the same web page; Example: "Continue Reading" or "Comment" style # tags
            // Stop tranquility from trying to process these links; default behavior is desired
            //
            var currentURL = encodeURIComponent(newTabBrowser.currentURI.spec.split("#")[0]);
            var turl = encodeURIComponent(url.split("#")[0]);
            if(turl == currentURL) {
                event.stopPropagation();
                return;
            }
          
            if(event.ctrlKey) { // Equivalent of right click Tranquility;so call that function and stop the event
                event.preventDefault();
                event.stopPropagation();
                Tranquility.onLinkRightClickContextMenu(url);
            }
            else {
                var strBundle = document.getElementById("tranquility-string-bundle");
                var notifyString = strBundle.getString('waitingForLoadNotification');
                var lnotification = PopupNotifications.show(newTabBrowser,
                                                            "tranquility_notify_doc_loading",
                                                            notifyString,
                                                            null, /* anchor ID */
                                                            null, /* main action */
                                                            null, /* secondary actions */
                                                            { /* options */
                                                                persistWhileVisible: true,
                                                                timeout: Date.now + 60000
                                                            }
                                                        );

                var linkLeftClickListener = function(e) { 
                    if((e.originalTarget.nodeName == "#document") &&
                       ((e.originalTarget.defaultView.location.href == url) ||
                        (e.originalTarget.defaultView.location.href == newTabBrowser.currentURI.spec))) {
                        Tranquility.gDOMLoaded[newTabBrowser.currentURI.spec] = true;
                        Tranquility.onToolBarOrKeyboard(newTabBrowser, null);
                        newTabBrowser.removeEventListener("DOMContentLoaded", linkLeftClickListener, true);
                        e.originalTarget.defaultView.focus(); // otherwise, spacebar does not scroll in continuous tranquil browsing mode
                        lnotification.remove();
                    }
                };
                newTabBrowser.addEventListener("DOMContentLoaded", linkLeftClickListener, true);
            }
        }
        else {
            if((contentDoc.getElementById('tranquility_links') != undefined) &&
               (contentDoc.getElementById('tranquility_links').style.visibility == 'visible')) {
                Tranquility.hideLinksDiv(contentDoc);  
            }
            else if((contentDoc.getElementById('tranquility_offline_links') != undefined) &&
                    (contentDoc.getElementById('tranquility_offline_links').style.visibility == 'visible')) {
                Tranquility.hideOfflineLinksDiv(contentDoc);  
            }
            else if(contentDoc.getElementById('tranquility_annotation_note') != undefined) {
                // First, check to see if the note has been modified/edited
                // If yes, update the original note element and update the DB
                var note = contentDoc.getElementById('tranquility_annotation_note');
                var orig_note;
                var orig_notes = contentDoc.getElementsByClassName('tranquility_annotation_text');
                for(var i=0; i < orig_notes.length; i++) {
                    if ((orig_notes[i].getAttribute('data-active-note') != undefined && 
                         orig_notes[i].getAttribute('data-active-note') == "true")) {
                        orig_note = orig_notes[i];
                    }
                }
                
                if(orig_note != undefined) {
                    orig_note.setAttribute('data-active-note', 'false');
                    if(orig_note.textContent != note.textContent) {
                        var note_p = note.childNodes;
                        var newText = "";
                        for(var i=0; i < note_p.length; i++) {
                            newText = newText + note_p[i].textContent + "\n";
                        }
                        orig_note.textContent = newText;

                        var masker = contentDoc.getElementById('tranquility_masker');
                        masker.style.visibility = 'hidden';            
                        note.parentNode.removeChild(note);
                        
                        var btn = contentDoc.getElementById('tranquility_offline_links_btn');
                        var url =  btn.getAttribute('data-active-link');
                        Tranquility.gTranquilDoc[url] = contentDoc.cloneNode(true);
                        Tranquility.saveContentOffline(url);                    
                    }
                }
                else {
                    // Next, delete the note view and hide the masker
                    var masker = contentDoc.getElementById('tranquility_masker');
                    masker.style.visibility = 'hidden';            
                    note.parentNode.removeChild(note);
                }
            }
            else if(contentDoc.getElementById('tranquility_view_notes') != undefined) {
                var masker = contentDoc.getElementById('tranquility_masker');
                masker.style.visibility = 'hidden';            
                var note = contentDoc.getElementById('tranquility_view_notes');
                note.parentNode.removeChild(note);
            }
            else
                Tranquility.hideDictionaryView(contentDoc);
        }
    },
    
    
    getAnchorNode: function (elem) {
    
        var urlString = elem.href;
 
        while((urlString == undefined) && (elem.parentNode != undefined)) {
            elem = elem.parentNode;     
            urlString = elem.href;
            if(urlString != undefined)
                return urlString;
        }
        return urlString;
    },
  
    hideLinksDiv: function(cdoc) {

        var target = cdoc.getElementById('tranquility_links');
        var masker = cdoc.getElementById('tranquility_masker');
        var dictfr = cdoc.getElementById('tranquility_dictionary');
        if(target != undefined) { 
            target.style.visibility = 'hidden';
            if((dictfr != undefined) && (dictfr.style.visibility == 'visible')) {
                // iframe is visible; so do not hide the masker
                // do nothing
            }
            else { 
                // Either iframe is not defined or it is hidden; so hide masker
                masker.style.visibility = 'hidden';
            }
        }
    },

    hideOfflineLinksDiv: function(cdoc) {

        var target = cdoc.getElementById('tranquility_offline_links');
        var masker = cdoc.getElementById('tranquility_masker');
        var dictfr = cdoc.getElementById('tranquility_dictionary');
        if(target != undefined) { 
            target.style.visibility = 'hidden';
            if((dictfr != undefined) && (dictfr.style.visibility == 'visible')) {
                // iframe is visible; so do not hide the masker
                // do nothing
            }
            else { 
                // Either iframe is not defined or it is hidden; so hide masker
                masker.style.visibility = 'hidden';
            }
        }
    },

    hideDictionaryView: function(cdoc) {

        var target = cdoc.getElementById('tranquility_dictionary');
        var masker = cdoc.getElementById('tranquility_masker');
        if(target != undefined) {
            target.style.visibility = 'hidden';
            masker.style.visibility = 'hidden';
        }
    },

    
    toggleMenuDisplay: function(newTabBrowser) {

        var cdoc = newTabBrowser.contentDocument;
        var expand_menu_btn = cdoc.getElementById('tranquility_expand_menu_btn');
        if (expand_menu_btn != undefined) {
            Tranquility.showMenuDiv(cdoc);
        }
        else {
            Tranquility.hideMenuDiv(cdoc);
        }
    },
    
    
    showMenuDiv: function(cdoc) {
        var menu_div = cdoc.getElementById('tranquility_menu');
        menu_div.style.height = '50px';
        menu_div.style.opacity = 1;
        var menu_items = menu_div.childNodes;
        for(var i=0; i < menu_items.length; i++) {
            menu_items[i].style.visibility = 'visible';
        };

        // Delete the expand menu button and trigger a hide of the menu 
        // within 10 seconds
        var expand_menu_btn = cdoc.getElementById('tranquility_expand_menu_btn');
        expand_menu_btn.parentNode.removeChild(expand_menu_btn);
        setTimeout(function() {
            Tranquility.hideMenuDiv(cdoc);
        }, 10000);

    },
    
    
    hideMenuDiv: function(cdoc) {

        // This is the setTimeout function for hiding menu after loading a page
        // either from the database or during the first tranquility conversion
        
        var menu_div = cdoc.getElementById('tranquility_menu');
        // Hide all the menu items and reduce its height
        var menu_items = menu_div.childNodes;
        for(var i=0; i < menu_items.length; i++) {
            menu_items[i].style.visibility = 'hidden';
        }
        menu_div.style.height = '0px';
        menu_div.style.opacity = 0.1;

        // Provide a simple button to expand the menu if it is auto-minimized
        var expand_menu_btn = cdoc.createElement('div');
        expand_menu_btn.setAttribute('title', 'Click to display menu - Escape key to toggle!');
        expand_menu_btn.setAttribute('class', 'tranquility_expand_menu_btn');
        expand_menu_btn.setAttribute('id', 'tranquility_expand_menu_btn');
        expand_menu_btn.textContent = "(+)";
        cdoc.body.appendChild(expand_menu_btn);
        expand_menu_btn.addEventListener("click", Tranquility.handleClickEvent, false);
    },
    
    
    toggleDictionaryView: function(cdoc) {

        var target = cdoc.getElementById('tranquility_dictionary');
        var masker = cdoc.getElementById('tranquility_masker');
        if(target != undefined) {
            if(target.style.visibility == 'visible') {
            target.style.visibility = 'hidden';
            masker.style.visibility = 'hidden';
            return;
            }
            if(target.style.visibility == 'hidden') {
                target.style.visibility = 'visible';
                masker.style.visibility = 'visible';
            }
        }
    },

  
    processXMLHTTPRequest: function(tBrowser, url, callback) {

        var oXHR = new XMLHttpRequest();
        oXHR.onreadystatechange = function() {
            if(oXHR.readyState === 4) {
                if(oXHR.status === 200) {
                    var cdoc = oXHR.responseText;
                    callback(tBrowser, cdoc); 
                }
            }        
        };

        oXHR.open("GET", url, true);
        oXHR.send(null);
    },

    computeSize: function(dElem) {

        // Compute size removes spaces to do a better job of true size calculations
        //
        if(dElem.innerHTML) {
            if(dElem.textContent) {
                return dElem.textContent.replace(/\s/g, '').length;
            }
            else if(dElem.innerText) {
                return dElem.innerText.replace(/\s/g, '').length;
            }
            else {
                return 0;
            }
        }
        else {
            return 0;
        }
    },

    reformatHeader: function(cdoc) {
   
        var hlink = cdoc.createElement('link');
        hlink.setAttribute('href', 'resource://tranquility/tranquility.css');
        hlink.setAttribute('rel',  'stylesheet');
        hlink.setAttribute('type', 'text/css');
        var heads = cdoc.getElementsByTagName('head');
        for(var i=0; i < heads.length; i++) {
            var hChildren = heads[i].getElementsByTagName("*");
            for(var j=hChildren.length -1; j > -1; j--) {
                if(hChildren[j].nodeName !== "TITLE") {
                    heads[i].removeChild(hChildren[j]);
                }
            }
            heads[i].appendChild(hlink);
        }
    },

    removeTag: function(cdoc, tagString) {

        var c = cdoc.getElementsByTagName(tagString);
        var len = c.length;
        var tElem;
        for(var dt=0; dt < len; dt++) {
            tElem = c[len-dt-1];
            // Do not delete iframes with links to youtube videos
            if((tagString == "IFRAME") && (tElem.src.search(/youtube/) != -1)) {
                continue;
            }

            if(tElem.id == undefined || tElem.id.substr(0,11) !== "tranquility") {
                tElem.parentNode.removeChild(tElem);
            }
        }
    },

    deleteHiddenElements: function(cdoc, tagString) {
        // Remove elements that have display==none or visibility==hidden
        var elems = cdoc.getElementsByTagName(tagString);
        for(var i=elems.length - 1; i >=0;  i--)  {
            if(((elems[i].style.visibility != undefined) && 
                (elems[i].style.visibility == 'hidden')) ||
               ((elems[i].style.display != undefined) && 
                (elems[i].style.display == 'none')))                                
                elems[i].parentNode.removeChild(elems[i]);
        }
    },
    

    pruneAdsTag: function(cdoc, url, tagString, thresholdPctg, totalSize) {

        var c = cdoc.getElementsByTagName(tagString);
        var len = c.length;
        var tElem;
        for(var i=0; i < len; i++) {
            tElem = c[len-i-1];

            // If the DIV has a H1 child, then we want to retain the article
            // heading and not delete it.
            var h1elems = tElem.getElementsByTagName("H1");
            if(h1elems.count > 0) 
                continue;

            var cLength = Tranquility.computeSize(tElem);
            var pctg = cLength/totalSize; 
            // If the DIV/SECTION/ARTICLE is empty remove it right away
            if(cLength == 0) {
                tElem.parentNode.removeChild(tElem);
            }
            // If the DIV does not contain a significant portion of the web content
            // AND the DIV contain mainly list elements then we can process to remove ads
            // Here, we use the "A" anchor node as a proxy for the LI node since each
            // navigation menu (or ads links menu) has a list of LI nodes that contain
            // anchor nodes with links to a new web page/section
            //
            else if(pctg < 0.8) { 
                var anchorNodes = tElem.getElementsByTagName("A");
                var anchorLength = 0;
                var num_words = 0;
                for(var j=0; j < anchorNodes.length; j++) { 
                    // Ignore links that are # tags in the same document
                    // These are typically table of content type links for the
                    // current document and are useful to retain
                    //
                    if(anchorNodes[j].href.split("#")[0] == url.split("#")[0])
                        continue;
                    anchorLength += Tranquility.computeSize(anchorNodes[j]);
                    num_words += anchorNodes[j].textContent.split(/\s+/).length;
                }
                var avg_words_per_anchor = num_words/anchorNodes.length;
                var inner_div_pctg = anchorLength/cLength; 
                // If the DIV has > thresholdPctg of its content within anchor nodes
                // remove, the DIV.  Additionally we can also look at the number of words
                // per anchor, but for now, that is not enabled
                if (inner_div_pctg >= thresholdPctg) {
                    tElem.parentNode.removeChild(tElem); 
                }
            }
            else {
                // Do nothing
            }
        }
    },

    pruneTag: function(cdoc, tagString, thresholdPctg, minSize, totalSize) {

        var c = cdoc.getElementsByTagName(tagString);
        var len = c.length;
        var tElem;
        for(var i=0; i < len; i++) {
            tElem = c[len-i-1];

            // If the DIV has a H1 child, then we want to retain the article
            // heading and not delete it.
            var h1elems = tElem.getElementsByTagName("H1");
            if(h1elems.count > 0) 
                continue;

            var cLength = Tranquility.computeSize(tElem);
            var pctg = cLength/totalSize; 
            // Experimental; do not delete if the text content is > threshold of innerHTML
            // currently hardcoded; trying to do better with blog style pages and comments
            var ilength = tElem.innerHTML.replace('/\s/g', '').length + 1;
            //var ilength = tElem.innerHTML.length + 1;
            var inner_html_pctg = cLength/ilength; 
            if (((inner_html_pctg < 0.5) && (pctg < thresholdPctg)) || (cLength <= minSize)) {
                //alert(tElem.id + "; " + cLength + "; " + totalSize + "; " + pctg + "; " + tElem.innerHTML);
                tElem.parentNode.removeChild(tElem); 
            }
            else {
                // Do nothing
            }
        }
    },


    replaceParent: function(cdoc, tagString, thresholdPctg) {

        var c = cdoc.getElementsByTagName(tagString);
        var cArray = [];
        var len = c.length;
        for(var i=0; i < len; i++) {
            cArray[i] = c[i];
        }
        cArray.sort(function (a,b) { return b.innerHTML.length - a.innerHTML.length } );
    
        var tElem; 
        for(var i=0; i < len; i++) {
            tElem = cArray[len-i-1];
            if((tElem.parentNode != undefined) && (tElem.parentNode.tagName == tElem.tagName)) {
                //var cLength = tElem.innerHTML.length;
                //var pLength = tElem.parentNode.innerHTML.length;
                var cLength = Tranquility.computeSize(tElem);
                var pLength = Tranquility.computeSize(tElem.parentNode);
                var pctg = cLength/pLength;
                if ((pctg > thresholdPctg)) {
                    // If grandparent exists replace parent with this element
                    // else, remove all siblings
                    var grandparent = tElem.parentNode.parentNode;
                    if(grandparent != undefined) 
                        grandparent.replaceChild(tElem.cloneNode(true), tElem.parentNode);
                    else { 
                        var siblings = tElem.parentNode.childNodes;
                        for(var j=siblings.length - 1; j > -1; j--) {
                            if(siblings[j] !== tElem) {
                                tElem.parentNode.removeChild(siblings[j]);
                            }
                        }
                    }
                }
                else {
                }
            }
        }
    },

    
    reformatTag: function(cdoc, tagString) {

        var c = cdoc.getElementsByTagName(tagString);
        for(var i=0; i < c.length; i++) {
            c[i].removeAttribute('class');
            c[i].removeAttribute('style');
            c[i].removeAttribute('width');
            c[i].setAttribute('class', 'tranquility');
        }
    },

    
    cleanupNavLinks: function(url) {
 
        var nlinks_div = Tranquility.gNavLinks[url];
        var nlinks = nlinks_div.getElementsByTagName('a');
        var nlinks_count = nlinks.length;
        var navRegExp = /^\d+$/;
        var nLinkExists = [];
        var intNavLinks = 0;

        for(var i=0; i < nlinks_count; i++) {
            var navStr = nlinks[i].textContent.replace(/\s/g, ''); 
            if(navStr.search(navRegExp) != -1)
                intNavLinks++;
        }

        for(var i=nlinks_count - 1; i > -1; i--) {
            var navStr = nlinks[i].textContent.replace(/\s/g, ''); 
            // Remove the link if the number within is greater than the total number
            // of navigation links collected.  This will eliminate arbitrary links
            // that have numbers within them
            //
            if((navStr.search(navRegExp) != -1) && (navStr > intNavLinks + 1))
                nlinks[i].parentNode.removeChild(nlinks[i]);
            // Remove links that are duplicates; some pages have navigation links at
            // the top and bottom of the page; no need for us to duplicate them
            //
            else if(nLinkExists[navStr] != undefined)
                nlinks[i].parentNode.removeChild(nlinks[i]);
            // Else remove comment style links from the navigation bar
            else if(nlinks[i].href.split("#")[0] == url) {
                nlinks[i].parentNode.removeChild(nlinks[i]);
            }
            else {
                // Do nothing
            }
            nLinkExists[navStr] = 1;    
        }
    },


    resizeImages: function(cdoc) {
        var images = cdoc.getElementsByTagName("img");
        var max_width = cdoc.body.clientWidth * 0.9 * Tranquility.prefs.getIntPref("defaultWidthPctg") / 100.0;
        for(var im=0; im < images.length; im++)  {
            images[im].removeAttribute('class');
            images[im].removeAttribute('style');
            if((images[im].width != undefined) && (images[im].height != undefined) &&
               (images[im].width > max_width))  {
                var aspect_ratio = images[im].height/images[im].width;
                images[im].width = max_width;
                images[im].height = max_width*aspect_ratio;
            }  
        } 
    },

    
    removeWhiteSpaceComments: function(cdoc) {

        var cnodes = cdoc.childNodes;
        for(var i=cnodes.length -1; i > -1; i--) {
            // Make sure that PRE nodes are ignored
            // Otherwise, their spaces and line breaks are removed
            // destroying their formatting
            if(cnodes[i].nodeName == "PRE") {
                continue;
            }
            if(cnodes[i].nodeType == 1) {
                Tranquility.removeWhiteSpaceComments(cnodes[i]);
            }
            if(cnodes[i].nodeType == 3) {
                var allText = cnodes[i].data;
                cnodes[i].data = allText.replace(/\s{2,}/g, ' ');
            }
            if(cnodes[i].nodeType == 8) {
                cnodes[i].parentNode.removeChild(cnodes[i]);
            }
        }
    },

  
    removeAnchorAttributes: function(cdoc) {

        var c = cdoc.getElementsByTagName('a');
        for(var i=0; i < c.length; i++) {
            if(c[i].getAttribute('target')) {
                c[i].removeAttribute('target');
            }
            if(c[i].getAttribute('class')) {
                c[i].removeAttribute('class');
            }
            if(c[i].getAttribute('onmousedown')) {
                c[i].removeAttribute('onmousedown');
            }
        }
    },

    
    removeDuplicateAndBadLinks: function(cdoc, url) {

        var encodedURL = encodeURIComponent(url.split("#")[0]);
        var re = new RegExp("^http:");

        var c = cdoc.getElementsByTagName('a');
        var bodyHrefs = [];
        for(var i=0; i < c.length; i++) {
            bodyHrefs[c[i].href] = 1;
        }

        var d = Tranquility.gOrigLinks[url].getElementsByTagName('a');
        var moreHrefCounts = [];
        for(var i=0; i < d.length; i++) {
            if(moreHrefCounts[d[i].href] != undefined)
                moreHrefCounts[d[i].href] += 1;
            else
                moreHrefCounts[d[i].href] = 1;
        }

        var len = d.length;
        for(var j=0; j < len; j++) {
            var tElem = d[len-j-1];
            // Remove link if the "More Links" anchor node is either present in the main document
            // or if it is a #tag reference to some element in the main document
            if(bodyHrefs[tElem.href] != undefined) {
                tElem.parentNode.removeChild(tElem);
            }
            else if(tElem.href.substr(0,10) == "javascript") {
                tElem.parentNode.removeChild(tElem);
            }
            else if(encodeURIComponent(tElem.href.split("#")[0]) == encodedURL) {
                tElem.parentNode.removeChild(tElem);
            }
            else if(tElem.textContent.replace('^/s+', '').search(re) != -1) {
                tElem.parentNode.removeChild(tElem);
            }
            else if((moreHrefCounts[tElem.href] != undefined) && (moreHrefCounts[tElem.href] > 1)) {
                moreHrefCounts[tElem.href] -= 1;
                tElem.parentNode.removeChild(tElem);
            }
            else {
                // Nothing to do
            }
        }
    },

  
    onRightClick: function() {
    
        var link_rightclick_menuitem = document.getElementById("tranquility-link-rightclick-context"); 
        var sel_wikipedia_menuitem = document.getElementById("tranquility-selection-rightclick-context-wikipedia"); 
        var sel_dictionary_menuitem = document.getElementById("tranquility-selection-rightclick-context-dictionary"); 
        var sel_annotation_menuitem = document.getElementById("tranquility-selection-rightclick-context-annotation"); 
        var cdoc = gBrowser.getBrowserForTab(gBrowser.selectedTab).contentDocument; 

        var not_tranquility_mode = true;
        if(cdoc.getElementById("tranquility_container"))
            not_tranquility_mode = false;

        if(link_rightclick_menuitem) {
            link_rightclick_menuitem.hidden = !gContextMenu.onSaveableLink;
        }
        if(sel_wikipedia_menuitem) {
            sel_wikipedia_menuitem.hidden = !gContextMenu.isTextSelected || not_tranquility_mode;
        }
        if(sel_dictionary_menuitem) {
            sel_dictionary_menuitem.hidden = !gContextMenu.isTextSelected || not_tranquility_mode;
        }
        if(sel_annotation_menuitem) {
            sel_annotation_menuitem.hidden = !gContextMenu.isTextSelected || not_tranquility_mode;
        }
    },

    
    applyFontPreferences: function(contentDoc) {
        // Apply font preferences
        var elems = contentDoc.documentElement.getElementsByTagName("*");
        for(var i=0; i < elems.length; i++) {
            if(elems[i].getAttribute('class') === 'tranquility' ||
               elems[i].getAttribute('class') === 'tranquility_annotation_note' ||
               elems[i].getAttribute('class') === 'tranquility_annotation_text' ||
               elems[i].getAttribute('class') === 'tranquility_annotation_selection' ||
               elems[i].getAttribute('class') === 'tranquility_annotation' ||
               elems[i].getAttribute('class') === 'tranquility_view_notes') {
                elems[i].style.fontSize = this.prefs.getIntPref("defaultFontSize") + "px";
                elems[i].style.fontFamily = this.prefs.getCharPref("defaultFont");
            }
        }   
    },
    
    observe: function(aSubject, aTopic, aData) {

        if(aTopic != "nsPref:changed") return;

        // Enable/disable single key for running Tranquility on current web page
        if (aData == "enableSingleKeyMode") {
            if(this.prefs.getBoolPref("enableSingleKeyMode"))
                document.getElementById("tranquility-single-key").setAttribute('disabled', 'false');
            else 
                document.getElementById("tranquility-single-key").setAttribute('disabled', 'true');
            return;
        }

        for(var j=0; j < gBrowser.browsers.length; j++) {
            var cdoc = gBrowser.browsers[j].contentDocument;
            if(cdoc.getElementById("tranquility_container")) {
                var elems = cdoc.documentElement.getElementsByTagName("*");
                if (aData == "useBackgroundImage") {
                    if(this.prefs.getBoolPref("useBackgroundImage")) {
                        cdoc.body.setAttribute('class', 'tranquility');
                    }
                    else {
                        cdoc.body.setAttribute('class', 'tranquility-no-image');
                    }  
                }
                else if(aData == "defaultFont") {
                    var newFont = this.prefs.getCharPref("defaultFont");
                    for(var i=0; i < elems.length; i++) {
                        if(elems[i].getAttribute('class') === 'tranquility' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_note' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_text' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_selection' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation' ||
                           elems[i].getAttribute('class') === 'tranquility_view_notes') 
                            elems[i].style.fontFamily = newFont;
                    }   
                }
                else if(aData == "defaultFontSize") {
                    var newSize = this.prefs.getIntPref("defaultFontSize");
                    for(var i=0; i < elems.length; i++) {
                        if(elems[i].getAttribute('class') === 'tranquility' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_note' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_text' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation_selection' ||
                           elems[i].getAttribute('class') === 'tranquility_annotation' ||
                           elems[i].getAttribute('class') === 'tranquility_view_notes')
                            elems[i].style.fontSize = newSize + "px";
                    }   
                }
                else if(aData == "defaultWidthPctg") {
                    var cdiv = cdoc.getElementById("tranquility_container");
                    cdiv.style.width = this.prefs.getIntPref("defaultWidthPctg") + "%"; 
                    var menu_div = cdoc.getElementById("tranquility_menu");
                    menu_div.style.width = this.prefs.getIntPref("defaultWidthPctg") + "%"; 
                    Tranquility.resizeImages(cdoc);
                }
                else if(aData == "defaultAlign") {
                    for(var i=0; i < elems.length; i++) {
                        if((elems[i].getAttribute('class')) && 
                           (elems[i].getAttribute('class').substr(0,11) === 'tranquility') &&
                           (elems[i].getAttribute('class') !== 'tranquility_links') &&
                           (elems[i].getAttribute('class') !== 'tranquility_nav_links') &&
                           (elems[i].getAttribute('class') !== 'tranquility_more_links_btn') &&
                           (elems[i].getAttribute('class') !== 'tranquility_offline_links_btn') &&
                           (elems[i].getAttribute('class') !== 'tranquility_viewnotes_btn') &&
                           (elems[i].getAttribute('class') !== 'tranquility_read_later_btn')) {
                            elems[i].style.textAlign = this.prefs.getCharPref("defaultAlign");
                        }
                    }
                }               
                else if(aData == "defaultLineHeightPctg") {
                    for(var i=0; i < elems.length; i++) {
                        if((elems[i].getAttribute('class')) && 
                           (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                            elems[i].style.lineHeight = this.prefs.getIntPref("defaultLineHeightPctg") + "%";
                        }
                    }   
                }
                else if((aData == "backgroundColor") || (aData == "useDefaultBackgroundColor")) {
                    if(aData == "backgroundColor") { 
                        this.prefs.setBoolPref("useDefaultBackgroundColor", false);
                        this.prefs.setBoolPref("useBackgroundImage", false);
                    }
                    var newBGColor = this.prefs.getCharPref("backgroundColor");
                    for(var i=0; i < elems.length; i++) {
                        if((elems[i].getAttribute('class')) && 
                           (elems[i].getAttribute('class') != 'tranquility_links') &&
                           (elems[i].getAttribute('class') != 'tranquility_masker') &&
                           (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                            if(this.prefs.getBoolPref("useDefaultBackgroundColor")) {
                                elems[i].style.backgroundColor = "#FDFDFD";
                            }
                            else {
                                elems[i].style.backgroundColor = newBGColor;
                            }
                        }
                    }   
                }
                else if((aData == "fontColor") || (aData == "useDefaultFontColor")) {
                    if(aData == "fontColor")
                        this.prefs.setBoolPref("useDefaultFontColor", false);
                    var newFontColor = this.prefs.getCharPref("fontColor");
                    for(var i=0; i < elems.length; i++) {
                        if((elems[i].getAttribute('class')) && 
                           (elems[i].getAttribute('class').substr(0,11) === 'tranquility')) {
                            if(this.prefs.getBoolPref("useDefaultFontColor")) {
                                elems[i].style.color = "#000000";
                            }
                            else {
                                elems[i].style.color = newFontColor;
                            }
                        }
                    }   
                }
                else if((aData == "linkColor") || (aData == "useDefaultLinkColor")) {
                    if(aData == "linkColor")
                        this.prefs.setBoolPref("useDefaultLinkColor", false);
                    var newLinkColor = this.prefs.getCharPref("linkColor");
                    for(var i=0; i < elems.length; i++) {
                        if(elems[i].tagName == 'A') { 
                            if(this.prefs.getBoolPref("useDefaultLinkColor")) {
                                elems[i].style.color = "#0000FF";
                            }
                            else {
                                elems[i].style.color = newLinkColor;
                            }
                        }
                    }   
                }
                else if((aData == "annotationHighlightColor")) {
                    var newHighlightColor = this.prefs.getCharPref("annotationHighlightColor");
                    for(var i=0; i < elems.length; i++) {
                        if(elems[i].className == 'tranquility_annotation_selection') { 
                            elems[i].style.backgroundColor = newHighlightColor;
                        }
                    }   
                }
            }
        }   
    },


    openPreferences: function() {
        window.open("chrome://tranquility/content/tranquility_options.xul", "", "chrome");
    },

    
    onTabClose: function(event) {
     
        var browser = gBrowser.getBrowserForTab(event.target);
        var url = browser.currentURI.spec;
        if(Tranquility.gOrigDoc[url] != undefined) {
            delete Tranquility.gOrigDoc[url];
            delete Tranquility.gTranquilDoc[url];
            delete Tranquility.gOrigLinks[url];
            delete Tranquility.gNavLinks[url];
            delete Tranquility.gDOMLoaded[url];
        }
    },

    
    onURLChange: function(aURI) {

        var openURLs = [];
        for(var i=0; i < gBrowser.browsers.length; i++) {
            openURLs[gBrowser.browsers[i].currentURI.spec] = 1;
        }

        var cachedURLs = [];
        for(var i in Tranquility.gOrigDoc) cachedURLs.push(i);

        for(var i=0; i < cachedURLs.length; i++) {
            if(cachedURLs[i] in openURLs) {
                // do nothing
            }
            else {
                delete Tranquility.gOrigDoc[cachedURLs[i]];
                delete Tranquility.gTranquilDoc[cachedURLs[i]];
                delete Tranquility.gOrigLinks[cachedURLs[i]];
                delete Tranquility.gNavLinks[cachedURLs[i]];
                delete Tranquility.gDOMLoaded[cachedURLs[i]];
            }
        } 
    },


    readLater: function(newTabBrowser) {
  
        var thisURL = newTabBrowser.currentURI.spec;
        var contentDoc = newTabBrowser.contentDocument;
        // If in tranquility view, then simply save content in DB
        if(contentDoc.getElementById('tranquility_container')) {
            Tranquility.saveContentOffline(thisURL);
        }
        // Else, get tranqulity view of content, save it offline
        else {
            Tranquility.onToolBarOrKeyboard(newTabBrowser, null);
            Tranquility.saveContentOffline(thisURL);
        }
    },
  

    saveContentOffline: function(thisURL) {

        var db;   
        var request = indexedDB.open("Tranquility_Offline_Content", 1);

        var strBundle = document.getElementById("tranquility-string-bundle");
        var dbOpenErrorString = strBundle.getString('dbOpenErrorString');
        var duplicateURLErrorString = strBundle.getString('duplicateURLErrorString');

        // Handle first time (database creation)
        request.onupgradeneeded = function(event) {    
            var db = event.target.result;
            var objectStore = db.createObjectStore("offline_content", {keyPath: "url"});
        };

        // Handle errors
        request.onerror = function(event) {
            alert(dbOpenErrorString + event.target.errorCode);
        };

        // Handle success
        request.onsuccess = function(event) {
            var db = request.result;
            var transaction = db.transaction(["offline_content"], "readwrite");
            var offline_docStore = transaction.objectStore("offline_content");
            var cdoc = Tranquility.gTranquilDoc[thisURL].cloneNode(true);
            var doctitle = cdoc.title;
            if(doctitle == undefined) {
                doctitle = thisURL;
            }
            var indata = {url: null, title: null, contentDoc: null};
            indata.url = thisURL;
            indata.title = doctitle;
            var s = new XMLSerializer();
            indata.contentDoc = s.serializeToString(cdoc); 
            // Modifying this from 'add' to 'put' in version 1.1.5.  
            // This is required to update the IndexedDB when we add 
            // annotations to the document and save the updated content.
            //var req = offline_docStore.add(indata); 
            var req = offline_docStore.put(indata); 
            req.onsuccess = function(event) {
            };
            req.onerror = function(event) {
                alert(duplicateURLErrorString);
            };      
        };
    },


    displayOfflineFiles: function() {
   
        var newTabBrowser = gBrowser.getBrowserForTab(gBrowser.selectedTab);
        var contentDoc = newTabBrowser.contentDocument;

        var strBundle = document.getElementById("tranquility-string-bundle");
        var dbOpenErrorString = strBundle.getString('dbOpenErrorString');

        var links_div = contentDoc.getElementById('tranquility_offline_links');
    
        // If div exists, delete and recreate children from IndexedDB
        if(links_div) {
            while( links_div.hasChildNodes() ){
                links_div.removeChild(links_div.lastChild);
            }
        }
        // Else create the div afresh
        else {
            var hlink = contentDoc.createElement('link');
            hlink.setAttribute('href', 'resource://tranquility/tranquility.css');
            hlink.setAttribute('rel',  'stylesheet');
            hlink.setAttribute('type', 'text/css');
            var heads = contentDoc.getElementsByTagName('head');
            for(var i=0; i < heads.length; i++) {
                heads[i].appendChild(hlink);
            }

            var links_div = contentDoc.createElement("div");
            links_div.setAttribute('id', 'tranquility_offline_links');
            links_div.setAttribute('class', 'tranquility_offline_links');
            contentDoc.body.appendChild(links_div);
            links_div.addEventListener("click", Tranquility.handleClickEvent, false);
        }
        
        var db;
        var request = indexedDB.open("Tranquility_Offline_Content", 1);

        // Handle first time (database creation)
        request.onupgradeneeded = function(event) {    
            var db = event.target.result;
            var objectStore = db.createObjectStore("offline_content", {keyPath: "url"});
        };

        // Handle errors
        request.onerror = function(event) {
            alert(dbOpenErrorString + event.target.errorCode);
        };

        // Handle success
        request.onsuccess = function(event) {
            var db = request.result;
            // Iterate through all objects in the database
            var transaction = db.transaction(["offline_content"], "readonly");
            var offline_docStore = transaction.objectStore("offline_content");

            offline_docStore.openCursor().onsuccess = function(evt) {
                var cursor = evt.target.result;
                if (cursor) {
                    var p_elem = contentDoc.createElement('p');
                    p_elem.setAttribute('class', 'tranquility_offline_link');
                    p_elem.setAttribute('id', cursor.key);
              
                    var del_img = contentDoc.createElement('img');
                    del_img.setAttribute('class', 'tranquility_delete_offline_link');
                    del_img.href = cursor.key;
                    del_img.src = "resource://tranquility-icons/delete_icon.png";
                    del_img.setAttribute('height', '20px');
                    del_img.setAttribute('width', '20px');
              
                    var del_a_elem = contentDoc.createElement('a');
                    del_a_elem.setAttribute('class', 'tranquility_delete_offline_link');
                    del_a_elem.href = cursor.key;
                    del_a_elem.appendChild(del_img.cloneNode(true));
                    p_elem.appendChild(del_a_elem.cloneNode(true));

                    var a_elem = contentDoc.createElement('a');
                    a_elem.setAttribute('class', 'tranquility_offline_link');
                    a_elem.textContent = "  " + cursor.value.title;
                    a_elem.href = cursor.key;
                    p_elem.appendChild(a_elem.cloneNode(true));
                    var links_div = contentDoc.getElementById('tranquility_offline_links');
                    links_div.appendChild(p_elem.cloneNode(true));
                    cursor.continue();
                }
                else {
                    Tranquility.applyFontPreferences(contentDoc);
                    var links_div = contentDoc.getElementById('tranquility_offline_links');
                    links_div.style.visibility = 'visible';
                }
            };
        };
    },
  
  
    loadDocFromDB: function(thisURL) {

        var newTabBrowser = gBrowser.getBrowserForTab(gBrowser.selectedTab);
        var contentDoc = newTabBrowser.contentDocument;

        var strBundle = document.getElementById("tranquility-string-bundle");
        var dbOpenErrorString = strBundle.getString('dbOpenErrorString');
        var urlNotFoundErrorString = strBundle.getString('urlNotFoundErrorString');

        var db;
        var request = indexedDB.open("Tranquility_Offline_Content", 1);

        // Handle first time (database creation)
        request.onupgradeneeded = function(event) {    
            var db = event.target.result;
            var objectStore = db.createObjectStore("offline_content", {keyPath: "url"});
        };

        // Handle errors
        request.onerror = function(event) {
            alert(dbOpenErrorString + event.target.errorCode);
        };

        // Handle success
        request.onsuccess = function(event) {
            var db = request.result;
            // Retreive data for the input url
            var transaction = db.transaction(["offline_content"], "readonly");
            var offline_docStore = transaction.objectStore("offline_content");

            var req = offline_docStore.get(thisURL);
            req.onerror = function(e) {
                // Handle errors!
                alert(urlNotFoundErrorString + thisURL);
            };
            req.onsuccess = function(e) {
                // Do something with the request.result!
                var parser = new DOMParser();
                var doc = parser.parseFromString(req.result.contentDoc, "text/xml");
                contentDoc.replaceChild(doc.documentElement, contentDoc.documentElement);
                Tranquility.applyFontPreferences(contentDoc);
                var btn = contentDoc.getElementById('tranquility_offline_links_btn');
                btn.setAttribute('data-active-link', thisURL);
                Tranquility.addBackEventListeners(contentDoc);
                Tranquility.gTranquilDoc[thisURL] = contentDoc.cloneNode(true);                
            };      
        };
    },
  
    
    delDocFromDB: function(thisURL) {

        var newTabBrowser = gBrowser.getBrowserForTab(gBrowser.selectedTab);
        var contentDoc = newTabBrowser.contentDocument;

        var strBundle = document.getElementById("tranquility-string-bundle");
        var dbOpenErrorString = strBundle.getString('dbOpenErrorString');
        var urlNotDeletedErrorString = strBundle.getString('urlNotDeletedErrorString');
    
        var db; 
        var request = indexedDB.open("Tranquility_Offline_Content", 1);

        // Handle first time (database creation)
        request.onupgradeneeded = function(event) {    
            var db = event.target.result;
            var objectStore = db.createObjectStore("offline_content", {keyPath: "url"});
        };

        // Handle errors
        request.onerror = function(event) {
            alert(dbOpenErrorString + event.target.errorCode);
        };

        // Handle success
        request.onsuccess = function(event) {
            var db = request.result;
            // Retreive data for the input url
            var transaction = db.transaction(["offline_content"], "readwrite");
            var offline_docStore = transaction.objectStore("offline_content");

            var req = offline_docStore.delete(thisURL);
            req.onerror = function(e) {
                // Handle errors!
                alert(urlNotDeletedErrorString + thisURL);
            };
            req.onsuccess = function(e) {
                // Do something with the request.result!
                var links_p = contentDoc.getElementById(thisURL);
                links_p.parentNode.removeChild(links_p);
            };      
        };
    },

 
    addAnnotation: function(newTabBrowser) {

        var contentDoc = newTabBrowser.contentDocument;       
        var cDocBkp = contentDoc.cloneNode(true);
        var selObj = contentDoc.getSelection();
        var masker = contentDoc.getElementById('tranquility_masker');
        masker.style.visibility = 'visible';

        // Create the wrapper annotation span
        var parent_span = contentDoc.createElement('span');
        parent_span.setAttribute('class', 'tranquility_annotation');
        parent_span.setAttribute('align', 'right');
     
        // Separate the selection range to a new span and highlight it
        // using the annotation background color
        var sel_span = contentDoc.createElement('span');
        sel_span.setAttribute('class', 'tranquility_annotation_selection');
        var range = selObj.getRangeAt(0);
        sel_span.appendChild(range.extractContents());
        var selectionSpan = sel_span.cloneNode(true);
        parent_span.appendChild(selectionSpan);
        range.insertNode(parent_span);
       
        // Create a form for entering the annotation;
        // if Submitted, then create annotation; else cancel
        var entryDiv = contentDoc.createElement('div');
        entryDiv.setAttribute('class', 'tranquility_annotation_entry');
        var note_width = Tranquility.prefs.getIntPref("defaultWidthPctg"); 
        var delta = (100 - note_width)/2;
        var target_width = Math.round(note_width * 0.8);
        entryDiv.style.width = target_width + "%";
        entryDiv.style.left = Math.round(delta + (0.1 * note_width)) + "%";
        contentDoc.body.appendChild(entryDiv);

        entryDiv.appendChild(contentDoc.createElement('p').cloneNode(true));
        
        var annotationText = contentDoc.createElement('textarea');
        annotationText.setAttribute('textAlign', 'left');
        annotationText.style.width = "70%";
        annotationText.style.height = "80%";
        annotationText.style.overflowY = 'scroll';
        annotationText.style.resize = 'none';
        entryDiv.appendChild(annotationText);
        
        entryDiv.appendChild(contentDoc.createElement('p').cloneNode(true));
        
        var submitButton = contentDoc.createElement('input');
        submitButton.setAttribute('type', 'button');
        submitButton.setAttribute('value', 'Submit');
        entryDiv.appendChild(submitButton);
        
        var cancelButton = contentDoc.createElement('input');
        cancelButton.setAttribute('type', 'button');
        cancelButton.setAttribute('value', 'Cancel');
        entryDiv.appendChild(cancelButton);
                
        submitButton.onclick = function() {

            var selectionSpan = parent_span.childNodes[0];
            selectionSpan.style.backgroundColor = Tranquility.prefs.getCharPref("annotationHighlightColor");
            
            // Add a place holder annotation text for now; will enhance later
            // to allow users to edit this content
            var note_p = contentDoc.createElement('p');
            note_p.setAttribute('class', 'tranquility_annotation_text');
            //note_p.textContent = "\n*****************************\n" + selectionSpan.textContent  + 
            //                     "\n*****************************\n\n" + annotationText.value;
            note_p.textContent = annotationText.value;
            parent_span.appendChild(note_p.cloneNode(true));
            
            // Create an event listener to capture mouse click on the iframe (to hide if required)
            parent_span.addEventListener("click", Tranquility.handleClickEvent, false);
            
            // delete the entry div
            entryDiv.parentNode.removeChild(entryDiv);
            var masker = contentDoc.getElementById('tranquility_masker');
            masker.style.visibility = 'hidden';
            
            // Save the updated content to the database
            var btn = contentDoc.getElementById('tranquility_offline_links_btn');
            // We could either be adding annotations to the offline content in which case
            // the URL key must be obtained from the 'data-active-link' attribute on tranquility_offline_links_btn
            // Or we could be adding annotations after the first run of Tranquility on that page
            // in which case the URL key is obtained from the currentURI.spec
            if(btn.getAttribute('data-active-link')) {
                var url = btn.getAttribute('data-active-link');
            }
            else {
                var url = newTabBrowser.currentURI.spec;
                btn.setAttribute('data-active-link', url);
            }
            Tranquility.applyFontPreferences(contentDoc);
            Tranquility.gTranquilDoc[url] = contentDoc.cloneNode(true);
            // But save to database only if not in private browsing mode
            if (!Tranquility.inPrivateBrowsingMode()) {
                Tranquility.saveContentOffline(url);
            }
        };
        
        cancelButton.onclick = function() {
            // On cancellation, restore the contentDoc from the backup
            Tranquility.addBackEventListeners(cDocBkp);
            contentDoc.replaceChild(cDocBkp.documentElement, contentDoc.documentElement);
        };
        
    },

    createAnnotationNote: function(contentDoc, note_p, read_width, ycoord) {

        var note_div = contentDoc.createElement('div');
        note_div.setAttribute('class', 'tranquility_annotation_note');
        note_div.setAttribute('id', 'tranquility_annotation_note');
        note_div.style.visibility = 'hidden';
        note_div.style.padding = '15px';
        //note_div.addEventListener("click", Tranquility.handleClickEvent, true);
        contentDoc.body.appendChild(note_div);

        note_p.setAttribute('class', 'tranquility_annotation_note');
        //note_p.addEventListener("click", Tranquility.handleClickEvent, true);
        note_div.appendChild(note_p);

        var delta = (100 - read_width)/2;
        var note_width = Math.round(read_width * 0.8);
        note_div.style.width = note_width + "%";
        note_div.style.left = Math.round(delta + (0.1 * read_width)) + "%";
        //note_div.style.top = Math.round(100.0*(ycoord + 40.0)/(1.0*window.innerHeight)) + "%";

        Tranquility.applyFontPreferences(contentDoc);
        return note_div;
    },

    viewAnnotationNotes: function(contentDoc, read_width) {

        var view_notes_div = contentDoc.createElement('div');
        view_notes_div.setAttribute('class', 'tranquility_view_notes');
        view_notes_div.setAttribute('id', 'tranquility_view_notes');
        view_notes_div.style.visibility = 'hidden';
        view_notes_div.style.padding = '15px';

        view_notes_div.addEventListener("click", Tranquility.handleClickEvent, false);
        contentDoc.body.appendChild(view_notes_div);
        
        var emptyp = contentDoc.createElement('p');
        var hline = contentDoc.createElement('hr');
        
        var notes = contentDoc.getElementsByClassName('tranquility_annotation');
        for (var i=0; i < notes.length; i++) {
            var sel = notes[i].getElementsByClassName('tranquility_annotation_selection')[0].cloneNode(true);
            sel.setAttribute('class', 'tranquility_view_notes');
            var txt = notes[i].getElementsByClassName('tranquility_annotation_text')[0];
            if (txt) {
                view_notes_div.appendChild(emptyp.cloneNode(true));
                view_notes_div.appendChild(sel.cloneNode(true));
                var note_p = txt.cloneNode(true);
                note_p.setAttribute('class', 'tranquility_view_notes');
                var note = contentDoc.createElement('blockquote');
                note.setAttribute('class', 'tranquility_view_notes');
                note.appendChild(note_p.cloneNode(true));
                view_notes_div.appendChild(note.cloneNode(true));
                view_notes_div.appendChild(emptyp.cloneNode(true));
                view_notes_div.appendChild(hline.cloneNode(true));            
            }
        }

        if(notes.length == 0) {
            var strBundle = document.getElementById("tranquility-string-bundle");
            view_notes_div.textContent = strBundle.getString('noNotes');
        }
        
        var delta = (100 - read_width)/2;
        var note_width = Math.round(read_width * 0.8);
        view_notes_div.style.width = note_width + "%";
        view_notes_div.style.left = Math.round(delta + (0.1 * read_width)) + "%";
        //view_notes_div.style.top = Math.round(100.0*(ycoord + 40.0)/(1.0*window.innerHeight)) + "%";

        Tranquility.applyFontPreferences(contentDoc);
        return view_notes_div;
    },
    
    addBackEventListeners: function(cdoc) {

        // Add back click event listener to body 
        cdoc.body.addEventListener("click", Tranquility.handleClickEvent, false);

        // Add back click event listener to more links button
        var links_button_div = cdoc.getElementById('tranquility_more_links_btn');
        if(links_button_div != undefined)
            links_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
 
        // Add back click event listener to offline links button
        var offlinefiles_button_div = cdoc.getElementById('tranquility_offline_links_btn');
        if(offlinefiles_button_div != undefined)
            offlinefiles_button_div.addEventListener("click", Tranquility.handleClickEvent, false);

        // Add back click event listener to read later button
        var readlater_button_div = cdoc.getElementById('tranquility_read_later_btn');
        if(readlater_button_div != undefined)
            readlater_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
       
        // Add back click event listener to view notes button
        var viewnotes_button_div = cdoc.getElementById('tranquility_viewnotes_btn');
        if(viewnotes_button_div != undefined)
            viewnotes_button_div.addEventListener("click", Tranquility.handleClickEvent, false);
       
        // Add back click event listener to dictionary iframe 
        var dict_frame = cdoc.getElementById('tranquility_dictionary');
        if(dict_frame != undefined)
            dict_frame.addEventListener("click", Tranquility.handleClickEvent, false);
            
    },

    
    onUnload: function() {

        // Remove progress listener
        gBrowser.removeTabsProgressListener(Tranquility_ProgressListener);
        gBrowser.tabContainer.removeEventListener("TabClose", Tranquility.onTabClose, false);

        if(!this.prefs) return;
    
        this.prefs.removeObserver("", this);
        return;
    }
};

window.addEventListener("load", function(e) { Tranquility.onLoad(e); }, false); 
window.addEventListener("unload", function(e) { Tranquility.onUnload(e); }, false); 

