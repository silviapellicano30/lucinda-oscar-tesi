document.addEventListener("DOMContentLoaded", () => {
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchQuery");
  const categorySelect = searchForm.querySelector('select[name="category"]');

  // --- 1. Placeholder Logic ---
  const placeholders = {
    document: "Search by DOI, PMID, Title...",
    author: "Search by ORCID, Name...",
    venue: "Search by ISSN, Name...",
    citation: "Search by OCI...",
    doc_cit: "Enter DOI/PMID to see citations...",
    doc_ref: "Enter DOI/PMID to see references..."
  };

  function updatePlaceholder() {
    const cat = categorySelect.value;
    searchInput.placeholder = placeholders[cat] || "Search...";
  }

  // Initialize and listen for changes
  updatePlaceholder();
  categorySelect.addEventListener("change", updatePlaceholder);


  // --- 2. Regex Definitions ---
  // Lucinda native prefixes
  const lucindaPrefixRegex = /^(br|ci|ra|ve):?/i;
  
  // External Identifiers
  const doiRegex = /^(doi:)?10\.\d{4,9}\/[^\s]+$/i;
  const pmidRegex = /^pmid:\d{1,8}$/i;
  const openalexRegex = /^openalex:W\d{10}$/i;
  
  // New Identifiers (ORCID & ISSN)
  // ORCID: 0000-0000-0000-0000 (16 digits, dashes, last can be X)
  const orcidRegex = /^(orcid:)?\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i;
  // ISSN: 0000-0000 (8 digits, dash, last can be X)
  const issnRegex = /^(issn:)?\d{4}-\d{3}[0-9X]$/i;

  function isDirectLucindaQuery(query) {
    return (
      lucindaPrefixRegex.test(query) ||
      doiRegex.test(query) ||
      pmidRegex.test(query) ||
      openalexRegex.test(query) ||
      orcidRegex.test(query) ||
      issnRegex.test(query)
    );
  }

  // --- 3. Search Submission ---
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault(); 

    const category = categorySelect.value;
    const query = searchInput.value.trim();

    if (!query) {
      alert("Please enter a search query.");
      return;
    }

    // If it looks like an ID (DOI, ORCID, etc.), resolve it
    if (isDirectLucindaQuery(query)) {
      await openLucinda(query, category);
      return;
    }

    // Otherwise, treat as Free Text Search
    // Matches: category/{query} -> handled by doc_free_text.hf / aut_free_text.hf etc.
    const lucindaUrl = `http://127.0.0.1:5500/example/oc/html_template/browser.html?value=${category}/${encodeURIComponent(query)}`;
    window.location.href = lucindaUrl;
  });
});

/**
 * Resolves external identifiers (DOI, ORCID, etc.) to an OMID using SPARQL.
 */
async function idToOmid(identifier) {
  const endpoint = "https://sparql.opencitations.net/meta";
  let scheme, cleanId;

  // Detect Scheme and Clean ID
  if (/^doi:|^10\.\d{4,9}\//i.test(identifier)) {
    scheme = "doi";
    cleanId = identifier.replace(/^doi:/i, "");
  } else if (/^pmid:/i.test(identifier)) {
    scheme = "pmid";
    cleanId = identifier.replace(/^pmid:/i, "");
  } else if (/^openalex:/i.test(identifier)) {
    scheme = "openalex";
    cleanId = identifier.replace(/^openalex:/i, "");
  } else if (/^orcid:|\d{4}-\d{4}-\d{4}-\d{3}[0-9X]/i.test(identifier)) {
    scheme = "orcid"; // datacite:orcid
    cleanId = identifier.replace(/^orcid:/i, "");
  } else if (/^issn:|\d{4}-\d{3}[0-9X]/i.test(identifier)) {
    scheme = "issn"; // datacite:issn
    cleanId = identifier.replace(/^issn:/i, "");
  } else {
    throw new Error("Unknown identifier type: " + identifier);
  }

  // SPARQL Query
  const query = `
    PREFIX datacite: <http://purl.org/spar/datacite/>
    PREFIX literal: <http://www.essepuntato.it/2010/06/literalreification/>
    SELECT ?omid WHERE {
      ?omid datacite:hasIdentifier ?identifier .
      ?identifier datacite:usesIdentifierScheme datacite:${scheme} ;
                  literal:hasLiteralValue "${cleanId}" .
    } LIMIT 1
  `;

  const url = endpoint + "?query=" + encodeURIComponent(query);

  const response = await fetch(url, {
    headers: { "Accept": "application/sparql-results+json" }
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error("The endpoint did not return valid JSON.");
  }

  if (!data.results || data.results.bindings.length === 0) {
    throw new Error(`No OMID found for ${identifier}`);
  }

  return data.results.bindings[0].omid.value;
}

/**
 * Handles logic for Direct ID queries (Resolve -> Redirect)
 */
async function openLucinda(identifier, category) {
  try {
    let omid;

    // Regex Checkers (Redefined scope for clarity)
    const doiRegex = /^(doi:)?10\.\d{4,9}\/[^\s]+$/i;
    const pmidRegex = /^pmid:\d{1,8}$/i;
    const openalexRegex = /^openalex:W\d{10}$/i;
    const orcidRegex = /^(orcid:)?\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i;
    const issnRegex = /^(issn:)?\d{4}-\d{3}[0-9X]$/i;

    // Check if resolution is needed
    if (
      doiRegex.test(identifier) ||
      pmidRegex.test(identifier) ||
      openalexRegex.test(identifier) ||
      orcidRegex.test(identifier) ||
      issnRegex.test(identifier)
    ) {
      omid = await idToOmid(identifier);
    } else {
      // Input is already a Lucinda ID (br/..., ra/...)
      omid = identifier;
    }

    // Clean OMID (remove base URL if present)
    const omidId = omid.replace("https://w3id.org/oc/meta/", "");

    // --- Contextual Redirect Logic ---
    // If the user specifically asked for Citations/References, prepend that prefix
    // Only applies if the resolved ID is a Bibliographic Resource (br/)
    let finalValue = omidId;

    if (omidId.startsWith("br/")) {
        if (category === "doc_cit") {
            finalValue = `doc_cit/${omidId}`;
        } else if (category === "doc_ref") {
            finalValue = `doc_ref/${omidId}`;
        }
    }

    const lucindaUrl = `http://127.0.0.1:5500/example/oc/html_template/browser.html?value=${finalValue}`;
    window.location.href = lucindaUrl;

  } catch (err) {
    console.error("Error:", err.message);
    alert("Error: " + err.message);
  }
}