# Recognition model

The deployed model is the audited Rafi Dataset II FP32 CNN, pinned by source commit and artifact hashes in public/models/manifest.json. [Audit](MODEL-AUDIT.md), [conversion reproduction](../scripts/model/README.md) and [runtime decision](decisions/004-model.md) document verified tensor names, shape, class order, preprocessing and license.

Its sixteen classes satisfy basic arithmetic vocabulary. Slash/simple fractions and x crossing interpretation are conservative application geometry/correction features, not extra classifier classes. General handwritten names remain unsupported; typed named variables use the shared evaluator.

A replacement must verify artifact/license, names/layout/classes, preprocessing, actual browser inference and uncertainty behavior against labelled ink before replacing this model. Separate letter and arithmetic classifiers have incompatible closed vocabularies; selecting whichever gives a larger score is not a validated mixed-symbol recognizer. Candidate websites or upstream accuracy reports alone do not satisfy this gate.
