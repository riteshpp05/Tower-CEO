import pandas as pd

df = pd.read_excel(
    r'F:\APNJ Intelligence\ROI Model.xlsx',
    sheet_name='Finance',
    header=None,
    dtype=str
)

print('Shape:', df.shape)
print()

for i, row in df.iterrows():
    vals = [str(v) for v in row.values if str(v) not in ['nan','None','NaN']]
    if vals:
        print(f'Row {i}: {vals[:8]}')
    if i > 20:
        break