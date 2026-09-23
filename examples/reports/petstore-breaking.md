# ContractGuard compatibility report

- Baseline: **petstore\-v1\.yaml**
- Candidate: **petstore\-v2\-breaking\.yaml**
- Score: **0/100**
- Backward compatible: **No**
- Generated: 2026-09-23T03:18:55.139Z

| Breaking | Potential | Non-breaking | Info | Total |
| ---: | ---: | ---: | ---: | ---: |
| 22 | 8 | 1 | 1 | 32 |

## Findings

### 1. [breaking] Path /health was removed\.

- Rule: `PATH_REMOVED`
- Location: `paths["/health"]`
- Recommendation: Retain the endpoint through a deprecation window or publish a new API version\.

### 2. [breaking] Required request parameter header:tenantId was added\.

- Rule: `PARAMETER_ADDED_REQUIRED`
- Location: `paths["/pets"].get.parameters.header["tenantId"]`
- Recommendation: Make the new parameter optional or introduce it in a new operation/version\.

### 3. [breaking] Parameter query:limit became required\.

- Rule: `PARAMETER_REQUIRED`
- Location: `paths["/pets"].get.parameters.query["limit"].required`
- Recommendation: Keep the parameter optional for existing callers\.

### 4. [breaking] maximum changed in a way that rejects previously valid input\.

- Rule: `SCHEMA_CONSTRAINT_TIGHTENED`
- Location: `paths["/pets"].get.parameters.query["limit"].schema.maximum`
- Recommendation: Retain the old constraint or introduce the constraint in a new API version\.

### 5. [breaking] The request enum accepts fewer values\.

- Rule: `SCHEMA_ENUM_NARROWED`
- Location: `paths["/pets"].get.parameters.query["tags"].schema.items.enum`
- Recommendation: Continue accepting every previously documented enum value during migration\.

### 6. [breaking] Produced output types changed incompatibly\.

- Rule: `SCHEMA_TYPE_CHANGED`
- Location: `paths["/pets"].get.responses["200"].content["application/json"].schema.items.properties["id"].type`
- Recommendation: Keep the old type in a transition release or introduce a new field/version\.

### 7. [breaking] A response property used by clients was removed\.

- Rule: `SCHEMA_PROPERTY_REMOVED`
- Location: `paths["/pets"].get.responses["200"].content["application/json"].schema.items.properties["name"]`
- Recommendation: Retain the property through a deprecation window or release a new API version\.

### 8. [breaking] Some previously valid callers now need additional authentication or scopes\.

- Rule: `SECURITY_STRENGTHENED`
- Location: `paths["/pets"].get.security`
- Recommendation: Keep an old authentication alternative during migration or version the operation\.

### 9. [breaking] The request enum accepts fewer values\.

- Rule: `SCHEMA_ENUM_NARROWED`
- Location: `paths["/pets"].post.requestBody.content["application/json"].schema.properties["category"].enum`
- Recommendation: Continue accepting every previously documented enum value during migration\.

### 10. [breaking] maxLength changed in a way that rejects previously valid input\.

- Rule: `SCHEMA_CONSTRAINT_TIGHTENED`
- Location: `paths["/pets"].post.requestBody.content["application/json"].schema.properties["name"].maxLength`
- Recommendation: Retain the old constraint or introduce the constraint in a new API version\.

### 11. [breaking] minLength changed in a way that rejects previously valid input\.

- Rule: `SCHEMA_CONSTRAINT_TIGHTENED`
- Location: `paths["/pets"].post.requestBody.content["application/json"].schema.properties["name"].minLength`
- Recommendation: Retain the old constraint or introduce the constraint in a new API version\.

### 12. [breaking] maxLength changed in a way that rejects previously valid input\.

- Rule: `SCHEMA_CONSTRAINT_TIGHTENED`
- Location: `paths["/pets"].post.requestBody.content["application/json"].schema.properties["note"].maxLength`
- Recommendation: Retain the old constraint or introduce the constraint in a new API version\.

### 13. [breaking] A required request property was added\.

- Rule: `SCHEMA_REQUIRED_PROPERTY_ADDED`
- Location: `paths["/pets"].post.requestBody.content["application/json"].schema.properties["ownerId"]`
- Recommendation: Make the new property optional or version the operation\.

### 14. [breaking] Request media type application/x\-www\-form\-urlencoded is no longer accepted\.

- Rule: `REQUEST_MEDIA_TYPE_REMOVED`
- Location: `paths["/pets"].post.requestBody.content["application/x-www-form-urlencoded"]`
- Recommendation: Retain the old media type until clients migrate\.

### 15. [breaking] Response status 201 was removed\.

- Rule: `RESPONSE_STATUS_REMOVED`
- Location: `paths["/pets"].post.responses["201"]`
- Recommendation: Keep the old response documented and supported until consumers migrate\.

### 16. [breaking] Produced output types changed incompatibly\.

- Rule: `SCHEMA_TYPE_CHANGED`
- Location: `paths["/pets"].post.responses["400"].content["application/json"].schema.properties["code"].type`
- Recommendation: Keep the old type in a transition release or introduce a new field/version\.

### 17. [breaking] Some previously valid callers now need additional authentication or scopes\.

- Rule: `SECURITY_STRENGTHENED`
- Location: `paths["/pets"].post.security`
- Recommendation: Keep an old authentication alternative during migration or version the operation\.

### 18. [breaking] Accepted input types changed incompatibly\.

- Rule: `SCHEMA_TYPE_CHANGED`
- Location: `paths["/pets/{petId}"].get.parameters.path["petId"].schema.type`
- Recommendation: Keep the old type in a transition release or introduce a new field/version\.

### 19. [breaking] Produced output types changed incompatibly\.

- Rule: `SCHEMA_TYPE_CHANGED`
- Location: `paths["/pets/{petId}"].get.responses["200"].content["application/json"].schema.properties["id"].type`
- Recommendation: Keep the old type in a transition release or introduce a new field/version\.

### 20. [breaking] A response property used by clients was removed\.

- Rule: `SCHEMA_PROPERTY_REMOVED`
- Location: `paths["/pets/{petId}"].get.responses["200"].content["application/json"].schema.properties["name"]`
- Recommendation: Retain the property through a deprecation window or release a new API version\.

### 21. [breaking] Produced output types changed incompatibly\.

- Rule: `SCHEMA_TYPE_CHANGED`
- Location: `paths["/pets/{petId}"].get.responses["404"].content["application/json"].schema.properties["code"].type`
- Recommendation: Keep the old type in a transition release or introduce a new field/version\.

### 22. [breaking] Some previously valid callers now need additional authentication or scopes\.

- Rule: `SECURITY_STRENGTHENED`
- Location: `paths["/pets/{petId}"].get.security`
- Recommendation: Keep an old authentication alternative during migration or version the operation\.

### 23. [potentially-breaking] operationId changed and may rename generated SDK methods\.

- Rule: `OPERATION_ID_CHANGED`
- Location: `paths["/pets"].get.operationId`
- Recommendation: Preserve operationId or publish an SDK migration note\.

### 24. [potentially-breaking] Schema keyword format changed; ContractGuard cannot prove the change is backward\-compatible\.

- Rule: `SCHEMA_UNSUPPORTED_KEYWORD_CHANGED`
- Location: `paths["/pets"].get.responses["200"].content["application/json"].schema.items.properties["id"].format`
- Recommendation: Review this keyword manually and add consumer contract tests before release\.

### 25. [potentially-breaking] The response may now contain values that existing exhaustive clients do not handle\.

- Rule: `SCHEMA_ENUM_WIDENED`
- Location: `paths["/pets"].get.responses["200"].content["application/json"].schema.items.properties["status"].enum`
- Recommendation: Version the enum or verify that consumers tolerate unknown values\.

### 26. [potentially-breaking] Response status 400 was removed\.

- Rule: `RESPONSE_STATUS_REMOVED`
- Location: `paths["/pets"].get.responses["400"]`
- Recommendation: Keep the old response documented and supported until consumers migrate\.

### 27. [potentially-breaking] A new success response 200 may require client handling\.

- Rule: `RESPONSE_STATUS_ADDED`
- Location: `paths["/pets"].post.responses["200"]`
- Recommendation: Verify generated and handwritten clients accept every documented success status\.

### 28. [potentially-breaking] Schema keyword format changed; ContractGuard cannot prove the change is backward\-compatible\.

- Rule: `SCHEMA_UNSUPPORTED_KEYWORD_CHANGED`
- Location: `paths["/pets/{petId}"].get.parameters.path["petId"].schema.format`
- Recommendation: Review this keyword manually and add consumer contract tests before release\.

### 29. [potentially-breaking] Schema keyword format changed; ContractGuard cannot prove the change is backward\-compatible\.

- Rule: `SCHEMA_UNSUPPORTED_KEYWORD_CHANGED`
- Location: `paths["/pets/{petId}"].get.responses["200"].content["application/json"].schema.properties["id"].format`
- Recommendation: Review this keyword manually and add consumer contract tests before release\.

### 30. [potentially-breaking] The response may now contain values that existing exhaustive clients do not handle\.

- Rule: `SCHEMA_ENUM_WIDENED`
- Location: `paths["/pets/{petId}"].get.responses["200"].content["application/json"].schema.properties["status"].enum`
- Recommendation: Version the enum or verify that consumers tolerate unknown values\.

### 31. [non-breaking] Request media type application/xml is now accepted\.

- Rule: `REQUEST_MEDIA_TYPE_ADDED`
- Location: `paths["/pets"].post.requestBody.content["application/xml"]`

### 32. [info] summary changed\.

- Rule: `METADATA_CHANGED`
- Location: `paths["/pets"].get.summary`

> Static rule analysis is not a formal proof of runtime compatibility.
