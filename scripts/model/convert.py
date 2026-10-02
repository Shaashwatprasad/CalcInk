#!/usr/bin/env python3
"""Reconstruct audited Keras model, export equivalent ONNX, assert numeric parity.
Usage: python scripts/model/convert.py /path/to/pinned/upstream
No training; all weights are the real upstream Dataset II checkpoint.
"""
import hashlib, json, pathlib, sys
import h5py, numpy as np, onnx, onnxruntime as ort
from onnx import helper as H, numpy_helper as N, TensorProto as T

root = pathlib.Path(__file__).resolve().parents[2]
source = pathlib.Path(sys.argv[1])
out = root / 'public/models'
out.mkdir(parents=True, exist_ok=True)
config = json.loads((source / 'model.json').read_text())
assert hashlib.sha256((source / 'modelWeight_dataset2.h5').read_bytes()).hexdigest() == '8ce0b567cba9677e83dde6c404b782f277c40e1f6c256e5641eae6131fa2d2a8', 'Unpinned source checkpoint'
weights = h5py.File(source / 'modelWeight_dataset2.h5', 'r')
print('HDF5 layers:', list(weights.keys()))
nodes, tensors = [], []
current = 'input'
shape = [1, 50, 50, 3]
nodes.append(H.make_node('Transpose', [current], ['nchw'], perm=[0,3,1,2])); current='nchw'
keras_weights = []
for layer in config['config']['layers']:
    kind, c = layer['class_name'], layer['config']; name=c['name']
    if kind in ['InputLayer','Dropout']: continue
    if kind in ['Conv2D','Dense']:
        group = weights[name]
        arrays=[]
        def collect(n, obj):
            if isinstance(obj,h5py.Dataset): arrays.append((n,np.array(obj,dtype=np.float32)))
        group.visititems(collect)
        kernel=next(a for n,a in arrays if 'kernel' in n); bias=next(a for n,a in arrays if 'bias' in n)
        keras_weights.append((name,kernel,bias))
        converted = kernel.transpose(3,2,0,1) if kind=='Conv2D' else kernel
        tensors += [N.from_array(converted,name+'_w'), N.from_array(bias,name+'_b')]
        if kind=='Conv2D':
            assert c['padding']=='same' and c['strides']==[1,1] and c['kernel_size']==[3,3]
            nodes.append(H.make_node('Conv',[current,name+'_w',name+'_b'],[name+'_pre'],pads=[1,1,1,1]))
        else: nodes.append(H.make_node('Gemm',[current,name+'_w',name+'_b'],[name+'_pre']))
        activation=c['activation']
        assert activation in ['relu','softmax']
        nodes.append(H.make_node('Relu' if activation=='relu' else 'Softmax',[name+'_pre'],[name],**({'axis':1} if activation=='softmax' else {})))
        current=name
    elif kind=='MaxPooling2D':
        assert c['padding']=='valid' and c['pool_size']==[2,2] and c['strides']==[2,2]
        nodes.append(H.make_node('MaxPool',[current],[name],kernel_shape=[2,2],strides=[2,2]));current=name
    elif kind=='Flatten':
        nodes.append(H.make_node('Transpose',[current],[name+'_nhwc'],perm=[0,2,3,1]))
        nodes.append(H.make_node('Flatten',[name+'_nhwc'],[name],axis=1));current=name
    else: raise ValueError(kind)
nodes.append(H.make_node('Identity',[current],['probabilities']))
graph=H.make_graph(nodes,'Rafi Dataset II', [H.make_tensor_value_info('input',T.FLOAT,shape)], [H.make_tensor_value_info('probabilities',T.FLOAT,[1,16])],tensors)
model=H.make_model(graph,opset_imports=[H.make_opsetid('',17)],producer_name='CalcInk audited direct exporter');model.ir_version=9
onnx.checker.check_model(model);onnx.save(model,out/'symbols.onnx')

import tensorflow as tf
# Keras 3 removes batch_input_shape: reconstruct layer arguments explicitly.
km=tf.keras.Sequential([tf.keras.layers.Input(shape=(50,50,3))])
for layer in config['config']['layers']:
    kind,c=layer['class_name'],layer['config'];name=c['name']
    if kind=='InputLayer':continue
    if kind=='Conv2D':km.add(tf.keras.layers.Conv2D(c['filters'],c['kernel_size'],padding=c['padding'],activation=c['activation'],name=name))
    elif kind=='MaxPooling2D':km.add(tf.keras.layers.MaxPooling2D(c['pool_size'],strides=c['strides'],padding=c['padding'],name=name))
    elif kind=='Dropout':km.add(tf.keras.layers.Dropout(c['rate'],name=name))
    elif kind=='Flatten':km.add(tf.keras.layers.Flatten(name=name))
    elif kind=='Dense':km.add(tf.keras.layers.Dense(c['units'],activation=c['activation'],name=name))
for name,k,b in keras_weights:km.get_layer(name).set_weights([k,b])
sess=ort.InferenceSession(str(out/'symbols.onnx'),providers=['CPUExecutionProvider'])
# Deterministic conversion fixtures are synthetic tensors, not an accuracy dataset.
fixtures=[np.ones(shape,dtype=np.float32),np.zeros(shape,dtype=np.float32)]
rng=np.random.default_rng(42)
fixtures += [rng.random(shape,dtype=np.float32) for _ in range(6)]
maximum,means,agree=0,[],0
for x in fixtures:
    expected=km(x,training=False).numpy();actual=sess.run(None,{'input':x})[0]
    delta=np.abs(expected-actual);maximum=max(maximum,float(delta.max()));means.append(float(delta.mean()))
    agree+=int(expected.argmax()==actual.argmax())
    np.testing.assert_allclose(expected,actual,atol=1e-5,rtol=1e-4)
report={'fixtures':'8 deterministic synthetic tensors (white, black, 6 random); not handwriting accuracy','maximumAbsoluteDeviation':maximum,'meanAbsoluteDeviation':float(np.mean(means)),'top1Agreement':f'{agree}/{len(fixtures)}','tolerance':{'atol':1e-5,'rtol':1e-4},'keras':tf.keras.__version__,'tensorflow':tf.__version__,'onnx':onnx.__version__,'onnxruntime':ort.__version__,'sourceSHA256':hashlib.sha256((source/'modelWeight_dataset2.h5').read_bytes()).hexdigest(),'onnxSHA256':hashlib.sha256((out/'symbols.onnx').read_bytes()).hexdigest()}
(out/'conversion-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
